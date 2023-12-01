const stripe = require("stripe")(process.env.STRIPE_SECRET);
const subscription = require("../models/subscription.model");
const User = require("../models/user.model");
const Product = require("../models/products.model");
const mongoose = require("mongoose");
const moment = require("moment");
const { isNumber } = require("lodash");

exports.subscriptionInfo = async (req, res, next) => {
  try {
    console.log("req", req);
    const currentUser = req?.user;
    console.log("req.user", req?.user);
    // if (!currentUser) {
    //   return res.status(401).json({ error: "Unauthorized" });
    // }

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

    // Attach the subscription info to the request object for later use
    req.subscriptionInfo = {
      trialValid: trialValid,
      isValid: isValid,
      hadSubscribed: hadSubscribed,
      planName: planName,
      currentSubscriptionValid: currentSubscriptionValid,
    };

    next(); // Move to the next middleware or route handler
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};
