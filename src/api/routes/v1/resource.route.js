const express = require("express");
const validate = require("express-validation");
const multer = require("multer");

const controller = require("../../controllers/resource.controller");

const { authorize } = require("../../middlewares/auth");

const router = express.Router();
const upload = multer();

router
  .route("/")
  .post(upload.array("files"), controller.fileSave)
  .delete(controller.fileDelete);

module.exports = router;
