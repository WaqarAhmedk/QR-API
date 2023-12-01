const mongoose = require("mongoose");
const excludeFieldsPlugin = require("./plugins/transform");
const { string } = require("joi");

const subscriptionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
      index: false,
    },
    stripeCustomerId: {
      type: String,
      required: false,
    },
    amount: {
      type: Number,
      required: false,
    },
    stripeProductId: {
      type: String,
      required: false,
    },
    stripePriceId: {
      type: String,
      required: false,
    },
    sessionId: {
      type: String,
      required: false,
    },
    annualPurchase: {
      type: Boolean,
    },
    planName: {
      type: String,
      required: false,
    },
    subscriptionId: {
      type: String,
    },
    paymentStatus: {
      type: Boolean,
    },
    cancelDate: {
      type: Date,
    },
    appliedToCancel: {
      type: Boolean,
    },
    isAnnual: {
      type: Boolean,
    },
    startDate: {
      type: Date,
    },
    endDate: {
      type: Date,
    },
    hadSubscribed: {
      type: Boolean,
    },
    customerDetails: {
      city: String,
      country: String,
      line1: String,
      line2: String,
      postal_code: String,
      state: String,
    },
    cardDetails: {
      brand: String,
      last4: Number,
    },
    stripeSubscriptionStatus: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

subscriptionSchema.plugin(excludeFieldsPlugin);

const Subscription = mongoose.model("subscriptions", subscriptionSchema);

module.exports = Subscription;
