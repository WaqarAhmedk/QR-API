const express = require("express");
const validate = require("express-validation");
const multer = require("multer");

const controller = require("../../controllers/qr.controller");
const {
  addQR,
  getQR,
  updateQR,
  deleteQR,
  userQR,
} = require("../../validations/qr.validation");
const { authorize, sameUser } = require("../../middlewares/auth");
const router = express.Router();
const upload = multer();

router.route("/").post(authorize(), validate(addQR), controller.create);

router
  .route("/:qrId")
  .get(validate(getQR), controller.get)
  .put(authorize(), validate(updateQR), controller.update)
  .delete(authorize(), validate(deleteQR), controller.delete);

router.post("/duplicate/:duplicateId", authorize(), controller.duplicate);

router
  .route("/user/:userId")
  .get(authorize(), validate(userQR), sameUser, controller.userQR);

router
  .route("/user/search/:userId")
  .get(authorize(), validate(userQR), sameUser, controller.searchUserQrs);

module.exports = router;
