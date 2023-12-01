const express = require("express");
const subscription = require("../../controllers/subscription");
const { authorize } = require("../../middlewares/auth");

const router = express.Router();

/**
 * GET v1/status
 */
router.get("/transactions", authorize(), subscription.getCustomerInvoices);
router.post("/create-plan", authorize(), subscription.createSubscriptionPlan);
router.post("/update-plan", authorize(), subscription.changeSubscriptionPlan);
router.post("/cancel-plan", authorize(), subscription.cancelSubscribedPlan);
router.get("/stripe-plan", authorize(), subscription.cancelSubscribedPlan);
router.get("/subscription-info", authorize(), subscription.subscriptionInfo);
router.post(
  "/revoke-plan",
  authorize(),
  subscription.revokeSubscribedCancelPlan
);
router.get("/get-plan", authorize(), subscription.getSubscribedPlan);
module.exports = router;
