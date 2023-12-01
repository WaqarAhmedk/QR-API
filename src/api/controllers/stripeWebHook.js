const stripe = require("stripe")(process.env.STRIPE_SECRET);
const Subscription = require("../models/subscription.model");
const User = require("../models/user.model");
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

function getKeyByProductId(productId) {
  const planToProductMap = {
    STARTER: "prod_OKieGxqxMLmcJc",
    LITE: "prod_OKiTjVnsek08K0",
    BUSINESS: "prod_OKiY85SvaDr9dk",
    PROFESSIONAL: "prod_OKigS5OEDLD4CI",
  };
  for (const key in planToProductMap) {
    if (planToProductMap[key] === productId) {
      return key;
    }
  }
  return null;
}

module.exports.stripeWebHook = async (request, response) => {
  const sig = request.headers["stripe-signature"];
  const event = request.body;
  console.log("event.type", event.type);

  switch (event.type) {
    case "customer.created": {
      try {
      } catch (error) {
        console.log("error in hook", error);
      }
    }
    case "customer.deleted": {
      try {
        break;
      } catch (error) {
        console.log("error in hook", error);
      }
    }

    case "customer.subscription.created": {
      try {
        const subscriptionId = event.data.object.id;
        const customer = event.data.object.customer;
        const subscription = event.data.object;

        await Subscription.findOneAndUpdate(
          {
            stripeCustomerId: customer,
          },
          {
            subscriptionId: subscriptionId,
          }
        );

        break;
      } catch (error) {
        console.log("error in hook", error);
      }
    }
    case "checkout.session.completed": {
      try {
        const session = event.data.object;
        const sessionId = event.data.object.id;

        await Subscription.findOneAndUpdate(
          {
            sessionId: sessionId,
          },
          {
            customerDetails: session.customer_details.address,
          }
        );
        break;
      } catch (error) {
        console.log("error in hook", error);
      }
    }

    case "invoice.payment_succeeded": {
      try {
        const invoice = event.data.object;
        const subInfo = await Subscription.findOneAndUpdate(
          {
            stripeCustomerId: invoice.customer,
          },
          {
            paymentStatus: invoice.paid,
            stripePaidAmount: invoice.amount_paid,
            stripeSubscriptionStatus: invoice.status,
            appliedToCancel: false,
            hadSubscribed: true,
          }
        );

        const saveUser = await User.findOneAndUpdate(
          {
            _id: subInfo.userId,
          },
          { subscriptionId: subInfo._id }
        );
        const userId = subInfo?.userId;
        const userInfo = await User.findById(userId);
        if (!userInfo?._id) {
          await stripe.subscriptions.update(subInfo?.subscriptionId, {
            cancel_at_period_end: true,
          });
          break;
        }
        break;
      } catch (error) {
        console.log("error in hook", error);
      }
    }
    case "invoice.payment_failed": {
      try {
        const invoice = await event.data.object;
        await Subscription.findOneAndUpdate(
          {
            subscriptionId: invoice.subscription,
          },
          {
            paymentStatus: invoice.paid,
            stripeSubscriptionStatus: invoice.status,
          }
        );
        break;
      } catch (error) {
        console.log("error in hook", error);
      }
    }
    case "payment_intent.succeeded": {
      const subscription = await event.data.object;
    }
    case "customer.subscription.updated": {
      try {
        const subscription = await event.data.object;
        const selectedExistingPlan = await Subscription.findOne({
          subscriptionId: subscription.id,
        });
        if (!selectedExistingPlan) break;

        const paymentMethod = await stripe.paymentMethods.attach(
          subscription.default_payment_method,
          {
            customer: subscription.customer,
          }
        );

        await stripe.customers.update(subscription.customer, {
          invoice_settings: {
            default_payment_method: paymentMethod.id,
          },
        });

        if (paymentMethod?.card?.brand) {
          const res = await Subscription.findOneAndUpdate(
            {
              subscriptionId: subscription.id,
            },
            {
              cardDetails: {
                brand: paymentMethod?.card?.brand,
                last4: paymentMethod?.card?.last4,
              },
              planName: getKeyByProductId(subscription?.plan?.product),
              stripePriceId: subscription?.plan?.id,
            }
          );
        }
        break;
      } catch (error) {
        console.log("error in hook", error);
      }
    }
    case "customer.subscription.deleted": {
      try {
        break;
        //send mail your Subscription Deleted Sucessfully
      } catch (error) {
        console.log("error in hook", error);
      }
    }
    default:
      console.log(`Unhandled event type ${event.type}`);
  }
  response.send();
};
