const stripe = require("stripe")(process.env.STRIPE_SECRET);
const subscription = require("../models/subscription.model");
const User = require("../models/user.model");
const Product = require("../models/products.model");
const mongoose = require("mongoose");
const moment = require("moment");
const { isNumber } = require("lodash");

//Retrieve an upcoming invoice
// const invoice = await stripe.invoices.retrieveUpcoming({
//   customer: "cus_9s6XKzkNRiz8i3",
// });

// util.js

function centsToDollar(cents) {
  return cents / 100;
}

function getHumanReadableDate(timestamp) {
  // Convert the timestamp to a Date object

  if (isNumber(timestamp)) {
    const dateObject = new Date(timestamp * 1000);

    // Extract the day, month, and year from the date object
    const day = dateObject.getDate();
    const month = dateObject.getMonth() + 1; // Months are 0-based, so we add 1
    const year = dateObject.getFullYear();

    // Format the date as a string in the desired format (e.g., "28/08/2023")
    const formattedDate = `${day.toString().padStart(2, "0")}/${month
      .toString()
      .padStart(2, "0")}/${year}`;

    return formattedDate;
  } else {
    // If the timestamp is in ISO 8601 format, convert it to a moment object
    return moment(timestamp).format("DD/MM/YYYY");
  }
}

// Example usage:

const planToProductMap = {
  STARTER: "prod_OKieGxqxMLmcJc",
  LITE: "prod_OKiTjVnsek08K0",
  BUSINESS: "prod_OKiY85SvaDr9dk",
  PROFESSIONAL: "prod_OKigS5OEDLD4CI",
};

module.exports.createSubscriptionPlan = async (req, res) => {
  const userId = req.user._id;
  const userEmail = req.user.email;
  const userName = req.user.firstName;
  const selectedPlan = req.body.selectedPlan; // Assuming the selected plan will be one of the plan variables (e.g., LITE, PRO, PREMIUM)
  const annualPurchase = req.body.annualPurchase;
  const fromHomePage = req.body.fromHomePage;

  try {
    const user = await User.findById(mongoose.Types.ObjectId(userId));
    let customerId;
    if (!user) {
      return res.status(400).json({ status: 404, data: "user not found" });
    }

    if (!user?.stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: userEmail,
        name: userName,
        metadata: { userId: userId.toString() },
      });
      await User.findByIdAndUpdate(user._id, {
        stripeCustomerId: customer.id,
      });
      customerId = customer.id;
    } else {
      customerId = user.stripeCustomerId;
    }

    const stripeProductId = planToProductMap[selectedPlan];
    const prices = await stripe.prices.list({ product: stripeProductId });

    // Find the price object for the annual plan and monthly plan
    const annualPlan = prices.data.find(
      (price) => price.recurring.interval === "year"
    );
    const monthlyPlan = prices.data.find(
      (price) => price.recurring.interval === "month"
    );

    const selectedPriceId = annualPurchase ? annualPlan.id : monthlyPlan.id;
    const price = annualPurchase
      ? annualPlan.unit_amount
      : monthlyPlan.unit_amount;

    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];
    const queryParams = new URLSearchParams({
      token: token,
      email: user.email,
      userId: user.id,
      role: user.role,
    });
    const session = await stripe.checkout.sessions.create({
      metadata: { userId: userId.toString() },
      line_items: [{ price: selectedPriceId, quantity: 1 }],
      mode: "subscription",
      billing_address_collection: "required",
      payment_method_collection: "always",
      success_url: fromHomePage
        ? process.env.SUCCESS_URL + "?" + queryParams
        : process.env.SUCCESS_URL,
      cancel_url: process.env.FAILURE_URL,
      customer: customerId,
    });

    const newSubscription = new subscription({
      userId: userId,
      plan: selectedPlan,
      amount: price,
      paymentStatus: false,
      isAnnual: annualPurchase,
      sessionId: session.id,
      stripePriceId: selectedPriceId,
      planName: selectedPlan, // Set the planName field here
      stripeCustomerId: session.customer,
    });

    await newSubscription.save();
    return res.status(200).json({
      status: 200,
      data: session.url,
    });
  } catch (e) {
    console.log("ERROR:", e);
    return res.status(400).json({ status: 400, data: e.message });
  }
};

module.exports.changeSubscriptionPlan = async (req, res) => {
  try {
    const userId = req.user._id;
    const userEmail = req.user.email;

    const { selectedPlan, annualPurchase } = req.body;
    const existingPlan = await subscription.findOne({
      userId,
      paymentStatus: { $eq: true },
    });

    if (!existingPlan) {
      throw new Error("Can not upgrade plan");
    }

    if (
      existingPlan?.selectedPlan === selectedPlan &&
      existingPlan?.annualPurchase === annualPurchase
    ) {
      throw new Error("Cannot upgrade to the same plan!");
    }

    const stripeProductId = planToProductMap[selectedPlan];
    const prices = await stripe.prices.list({ product: stripeProductId });
    const annualPlan = prices.data.find(
      (price) => price.recurring.interval === "year"
    );
    const monthlyPlan = prices.data.find(
      (price) => price.recurring.interval === "month"
    );

    const price = annualPurchase
      ? annualPlan.unit_amount
      : monthlyPlan.unit_amount;

    const selectedPriceId = annualPurchase ? annualPlan.id : monthlyPlan.id;

    // Set the next billing date to the start of the current subscription's next billing period
    const currentSubscription = await stripe.subscriptions.retrieve(
      existingPlan?.subscriptionId
    );
    console.log("current subscription", currentSubscription);
    const currentBillingEnd = currentSubscription.current_period_end;
    const nextBillingDate = new Date(currentBillingEnd * 1000);
    nextBillingDate.setUTCSeconds(0); // Reset seconds to 0 to avoid potential issues
    console.log("currentBillingEnd", currentBillingEnd);
    // Cancel the current subscription but set it to end at the billing period's end
    await stripe.subscriptions.update(existingPlan?.subscriptionId, {
      cancel_at_period_end: true,
    });

    console.log(
      "nextBillingDate.getTime() / 1000",
      nextBillingDate.getTime() / 1000
    );

    // Update the user's current subscription to the new one with billing cycle anchor for the next billing period
    await stripe.subscriptions.create({
      customer: existingPlan?.stripeCustomerId,
      items: [{ price: selectedPriceId }],
      proration_behavior: "none",
      billing_cycle_anchor: Math.floor(nextBillingDate.getTime() / 1000), // Unix timestamp of the next billing date
    });

    // Return the success response
    return res.status(200).json({
      status: 200,
      data: process.env.SUCCESS_URL,
    });
  } catch (e) {
    return res.status(400).json({ status: 400, msg: e.message, data: {} });
  }
};

module.exports.cancelSubscribedPlan = async (req, res) => {
  try {
    const { subscriptionId } = req.user;
    const existingSubscription = await subscription.findOne({
      _id: subscriptionId,
    });
    if (!existingSubscription) {
      return res.status(404).json({ error: "Plan not found." });
    }

    const stripeSubscription = await stripe.subscriptions.retrieve(
      existingSubscription.subscriptionId
    );
    if (
      stripeSubscription.status === "canceled" ||
      existingSubscription.appliedToCancel
    ) {
      return res
        .status(400)
        .json({ message: "Subscription is already canceled." });
    }

    existingSubscription.appliedToCancel = true;
    await existingSubscription.save();

    const updatedStripeSubscription = await stripe.subscriptions.update(
      existingSubscription.subscriptionId,
      {
        cancel_at_period_end: true,
      }
    );

    return res.json({
      message: "Subscription cancellation applied successfully.",
      appliedToCancel: true,
      cancellationDate: getHumanReadableDate(
        updatedStripeSubscription.cancel_at
      ),
    });
  } catch (error) {
    return res.status(500).json({
      message: "An error occurred while processing the cancellation.",
    });
  }
};

module.exports.revokeSubscribedCancelPlan = async (req, res) => {
  try {
    const { subscriptionId } = req.body;
    const exisitingPlan = await subscription.findById(subscriptionId);
    if (!exisitingPlan) {
      return res
        .status(400)
        .json({ status: 400, msg: "Plan not found", data: {} });
    }
    const newSubscription = await stripe.subscriptions.retrieve(
      exisitingPlan.subscriptionId
    );
    const items = [
      {
        id: newSubscription.items.data[0].id,
        price: newSubscription.plan.id, // Switch to new price
      },
    ];
    const resesponse = await stripe.subscriptions.update(
      exisitingPlan.subscriptionId,
      {
        items,
        cancel_at_period_end: false,
        proration_behavior: "create_prorations",
      }
    );

    exisitingPlan.appliedToCancelled = false;
    const saveSubscription = await exisitingPlan.save();
    return res.status(200).json({
      success: true,
      msg: "Successfuly revoke you Plan",
      data: saveSubscription,
    });
  } catch (e) {
    return res.status(400).json({ status: 400, data: e.message });
  }
};
module.exports.getSubscribedPlan = async (req, res) => {
  try {
    const userId = req.user._id;
    let isTrail = false;
    let current_period_start;
    let current_period_end;
    const existingPlan = await subscription.findOne({
      userId: userId,
      paymentStatus: { $ne: "FAIL" },
      subscriptionDeleted: { $ne: true },
    });
    if (existingPlan) {
      const stripeSubscription = await stripe.subscriptions.retrieve(
        existingPlan?.subscriptionId
      );
      if (stripeSubscription?.status === "trialing") {
        isTrail = true;
        current_period_start = stripeSubscription.current_period_start * 1000;
        current_period_end = stripeSubscription.current_period_end * 1000;
      }
    }
    return res.status(200).json({
      status: 200,
      data: existingPlan ? existingPlan : {},
      isTrail: isTrail,
      current_period_start: current_period_start,
      current_period_end: current_period_end,
      msg: existingPlan ? "Data Found" : "No Data Found",
    });
  } catch (e) {
    console.log("ERROR:", e);
    return res.status(400).json({ status: 400, data: e.message });
  }
};

module.exports.getCustomerInvoices = async (req, res) => {
  try {
    const stripeCustomerId = req?.user?.stripeCustomerId;
    const user = req?.user;
    const currentSubscription = await subscription.findOne({
      stripeCustomerId: stripeCustomerId,
    });

    let current_subscription = "";

    let nextInvoice = null;
    let refactorInvoices = [];
    if (stripeCustomerId) {
      const invoices = await stripe.invoices.list({
        customer: stripeCustomerId,
      });

      try {
        nextInvoice = await stripe.invoices.retrieveUpcoming({
          customer: stripeCustomerId,
        });
      } catch (error) {
        console.error(
          "Error while retrieving upcoming invoice:",
          error.message
        );
      }

      refactorInvoices = invoices?.data?.map((i) => {
        return {
          date: getHumanReadableDate(i.created), // Convert timestamp to human-readable date
          status: i.status,
          amount: {
            amount_paid: i.amount_paid,
            amount_remaining: i.amount_remaining,
          },
          address: i.customer_address,
          invoices: i.hosted_invoice_url,
        };
      });
    }

    const isTrialValid = user?.trialExpirationDate
      ? new Date() <= user.trialExpirationDate
      : null;

    // Add the "Free" plan to the response if the trial is valid
    const plan =
      isTrialValid && !currentSubscription?.planName
        ? "Free"
        : currentSubscription?.planName;

    if (currentSubscription?.subscriptionId) {
      current_subscription = await stripe.subscriptions.retrieve(
        currentSubscription?.subscriptionId
      );
    }

    return res.status(200).json({
      status: 200,
      data: {
        invoices: refactorInvoices || [],
        nextInvoice: nextInvoice
          ? {
              starting_date:
                getHumanReadableDate(nextInvoice?.next_payment_attempt) || "",
              amount: nextInvoice?.total || 0,
            }
          : null,
        customerCard: currentSubscription?.cardDetails || {},
        customerBillingInfo: currentSubscription?.customerDetails || {},
        paymentStatus: currentSubscription?.stripeSubscriptionStatus,
        plan: plan,
        amount: centsToDollar(currentSubscription?.amount),
        appliedToCancel: current_subscription?.cancel_at_period_end,
        stripeSubscriptionStatus: currentSubscription?.stripeSubscriptionStatus,
        trialExpirationDate:
          getHumanReadableDate(user?.trialExpirationDate) || null,
        isTrialValid: isTrialValid && !currentSubscription?.paymentStatus,
      },
    });
  } catch (e) {
    return res.status(400).json({ status: 400, data: e.message });
  }
};

module.exports.subscriptionInfo = async (req, res) => {
  try {
    const currentUser = req?.user;
    if (!currentUser) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    let trialValid = false;
    let isValid = false;
    let hadSubscribed = false;
    let planName = "";
    let currentSubscriptionValid = false;
    if (currentUser.createdBy) {
      const createdByUser = await User.findOne({ _id: currentUser.createdBy });
      if (createdByUser) {
        trialValid = createdByUser.trialExpirationDate
          ? new Date() <= createdByUser.trialExpirationDate
          : false;

        const currentSubscription = await subscription.findOne({
          userId: createdByUser._id,
        });

        if (currentSubscription) {
          isValid = currentSubscription.paymentStatus;
          hadSubscribed = currentSubscription.hadSubscribed;
          planName = currentSubscription.planName || "";
          currentSubscriptionValid = currentSubscription.paymentStatus;
        }
      }
    } else {
      const currentSubscription = await subscription.findOne({
        userId: currentUser.id,
      });

      if (currentSubscription) {
        isValid = currentSubscription.paymentStatus;
        hadSubscribed = currentSubscription.hadSubscribed;
        planName = currentSubscription.planName || "";
        currentSubscriptionValid = currentSubscription.paymentStatus;
      }
      trialValid = currentUser.trialExpirationDate
        ? new Date() <= currentUser.trialExpirationDate
        : false;
    }
    isValid = trialValid || isValid;
    return res.status(200).json({
      trialValid: trialValid,
      isValid: isValid,
      hadSubscribed: hadSubscribed,
      planName: planName,
      currentSubscriptionValid: currentSubscriptionValid,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};
