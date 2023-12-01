const httpStatus = require("http-status");
const QR = require("../models/qr.model");
const Folder = require("../models/folder.model");
const APIError = require("../errors/api-error");
var ObjectId = require("mongodb").ObjectID;
const User = require("../models/user.model");
const subscription = require("../models/subscription.model");

/**
 * Create new qr
 * @public
 */
exports.create = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    const freeQrTypes = ["Url", "Sms", "MakeCall"];
    let createdByValid = false;
    let createdByTrialValid = false;

    const createdBy = req.user.createdBy;
    if (createdBy) {
      const createdByUser = await User.findOne({ _id: createdBy });
      createdByTrialValid = createdByUser?.trialExpirationDate
        ? new Date() <= createdByUser.trialExpirationDate
        : null;

      const createdBySubscription = await subscription.findOne({
        userId: createdBy,
      });

      if (createdBySubscription && createdBySubscription?.paymentStatus) {
        createdByValid = true;
      }
    }

    const userSubscription = await subscription.findOne({
      _id: user.subscriptionId,
    });

    const currentSubscription = await subscription.findOne({
      userId: user.id,
    });
    const trialValid = user?.trialExpirationDate
      ? new Date() <= user.trialExpirationDate
      : null;

    const isValid =
      trialValid ||
      currentSubscription?.paymentStatus ||
      createdByValid ||
      createdByTrialValid;

    if (!isValid) {
      if (!freeQrTypes.includes(req.body.qrType)) {
        return res.status(httpStatus.PAYMENT_REQUIRED).json({
          message: "Payment Required",
        });
      }
      if (
        req.body.eyeBall != "eye-ball-plain-square" ||
        req.body.eyeFrame != "eye-frame-plain-square" ||
        req.body.pattern != "rounded" ||
        req.body.logo ||
        req.body.qrFrame != "none"
      ) {
        return res.status(httpStatus.PAYMENT_REQUIRED).json({
          message: "Payment Required",
        });
      }
    }

    const qrCount = await QR.countDocuments({
      user: req.user._id,
      updateAndTack: true,
    });

    // if (req.body.updateAndTrack) {
    //   let maxQRLimit;
    //   switch (userSubscription?.selectedPlan) {
    //     case "starter":
    //       maxQRLimit = 5;
    //       break;
    //     case "lite":
    //       maxQRLimit = 50;
    //       break;
    //     case "business":
    //       maxQRLimit = 250;
    //       break;
    //     case "professional":
    //       maxQRLimit = 500;
    //       break;
    //     default:
    //       maxQRLimit = 0;
    //   }
    //   console.log("qrCount", qrCount >= maxQRLimit);
    //   if (qrCount >= maxQRLimit) {
    //     return res.status(httpStatus.FORBIDDEN).json({
    //       error: `Maximum QR code limit reached for ${userSubscription.paymentPlan} plan.`,
    //     });
    //   }
    // }

    let folderId = req.body.qrFolder ? req.body.qrFolder : "";
    if (!folderId || folderId === "General") {
      const generalFolder = await Folder.findOne({
        owner: req.user._id,
        name: "General",
      });

      if (generalFolder) {
        folderId = generalFolder._id;
      } else {
        const newFolder = new Folder({ name: "General", owner: req.user._id });
        const savedFolder = await newFolder.save();
        folderId = savedFolder._id;
      }
    }

    const qr = new QR({ ...req.body, user: req.user._id, folder: folderId });

    const savedQR = await qr.save();
    res.status(httpStatus.CREATED);
    return res.json(savedQR);
  } catch (error) {
    console.log("error in Qr create", error);
    return next(error);
  }
};

/**
 * Get QR
 * @public
 */
exports.get = async (req, res, next) => {
  try {
    const qr = await QR.get(req.params.qrId);
    res.status(httpStatus.OK);
    res.json(qr);
  } catch (error) {
    return next(error);
  }
};

/**
 * Update QR
 * @public
 */

exports.update = async (req, res, next) => {
  try {
    const qr = await QR.findByIdAndUpdate(req.params.qrId, req.body, {
      new: true,
    });

    res.status(httpStatus.OK);
    res.json(qr);
  } catch (error) {
    return next(error);
  }
};

exports.delete = async (req, res, next) => {
  try {
    const qr = await QR.get(req.params.qrId);
    if (qr.user._id.toString() != req.user._id.toString()) {
      throw new APIError({
        status: httpStatus.FORBIDDEN,
        message: "QR deletion not allowed",
      });
    }
    qr.remove()
      .then(() => res.status(httpStatus.NO_CONTENT).end())
      .catch((e) => next(e));
  } catch (error) {
    return next(error);
  }
};

exports.userQR = async (req, res, next) => {
  try {
    let qrStatusFilter = {};

    if (req.query.type === "all") {
      qrStatusFilter = { $ne: "Deleted" };
    } else if (req.query.type === "deleted") {
      qrStatusFilter = "Deleted";
    }

    const current = await User.findById(req.params.userId);

    let users = [current];
    if (current.createdBy) {
      let tempUsers = await User.find({
        $or: [{ createdBy: current.createdBy }, { _id: current.createdBy }],
      });
      if (tempUsers && Array.isArray(tempUsers)) users.push(...tempUsers);
    } else {
      let tempUsers = await User.find({ createdBy: current._id });
      if (tempUsers && Array.isArray(tempUsers)) users.push(...tempUsers);
    }

    const userIds = [...users.map((user) => user._id)];

    const offset = parseInt(req.query.offset) || 0;
    const limit = parseInt(req.query.limit) || 10;

    const totalRecords = await QR.countDocuments({
      user: { $in: userIds },
      qrStatus: qrStatusFilter,
    });

    const totalPages = Math.ceil(totalRecords / limit);

    const skip = offset;
    const qrs = await QR.aggregate([
      {
        $lookup: {
          from: "analytics",
          localField: "_id",
          foreignField: "qrId",
          as: "result",
        },
      },
      {
        $match: {
          user: { $in: userIds },
          qrStatus: qrStatusFilter,
        },
      },
      {
        $addFields: {
          scanCount: { $size: "$result" },
        },
      },
      {
        $lookup: {
          from: "folders",
          let: { folderId: "$folder" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $eq: ["$_id", "$$folderId"],
                },
              },
            },
          ],
          as: "folder",
        },
      },
      {
        $unwind: "$folder",
      },
      {
        $lookup: {
          from: "labels",
          localField: "label",
          foreignField: "_id",
          as: "label",
        },
      },

      {
        $sort: {
          createdAt: -1,
        },
      },
      {
        $skip: skip,
      },
      {
        $limit: limit,
      },
    ]);

    res.status(httpStatus.OK).json({
      qrs: qrs,
      currentPage: Math.floor(offset / limit) + 1,
      totalPages: totalPages,
      totalRecords: totalRecords,
    });
  } catch (error) {
    next(error);
  }
};

exports.searchUserQrs = async (req, res, next) => {
  try {
    const qrTypeFilter = req.query.qrType;
    const qrNameFilter = req.query.qrName;
    const qrStatusFilter = req.query.qrStatus;
    const qrSortBy = req.query.sortBy;
    const folderId = req.query.qrFolder;
    const labelId = req.query.qrLabel;
    const notInclude =
      req.query.searchType === "all"
        ? ["Deleted"]
        : ["Active", "Paused", "Blocked"];

    // Find the createdBy user
    const current = await User.findById(req.params.userId);

    let users = [current];
    if (current.createdBy) {
      let tempUsers = await User.find({
        $or: [{ createdBy: current.createdBy }, { _id: current.createdBy }],
      });
      if (tempUsers && Array.isArray(tempUsers)) users.push(...tempUsers);
    } else {
      let tempUsers = await User.find({ createdBy: current._id });
      if (tempUsers && Array.isArray(tempUsers)) users.push(...tempUsers);
    }

    // Get the IDs of all users (including createdByUser)
    const userIds = [...users.map((user) => user._id)];

    const matchStage = {
      $match: {
        user: { $in: userIds },
      },
    };

    if (qrStatusFilter) {
      matchStage.$match.qrStatus = { $regex: qrStatusFilter, $options: "i" };
    } else {
      matchStage.$match.qrStatus = { $nin: notInclude };
    }

    if (qrTypeFilter) {
      matchStage.$match.qrType = { $regex: qrTypeFilter, $options: "i" };
    }

    if (qrNameFilter) {
      matchStage.$match.qrName = { $regex: qrNameFilter, $options: "i" };
    }

    const pipeline = [
      {
        $lookup: {
          from: "analytics",
          localField: "_id",
          foreignField: "qrId",
          as: "result",
        },
      },
      matchStage,
      {
        $addFields: {
          scanCount: { $size: "$result" },
        },
      },
      {
        $lookup: {
          from: "folders",
          let: { folderId: "$folder" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $eq: ["$_id", "$$folderId"],
                },
              },
            },
          ],
          as: "folder",
        },
      },
      {
        $unwind: "$folder",
      },
      {
        $lookup: {
          from: "labels",
          localField: "label",
          foreignField: "_id",
          as: "label",
        },
      },
      {
        $sort: {
          createdAt: -1,
        },
      },
    ];

    if (folderId) {
      pipeline.push({
        $match: {
          "folder._id": ObjectId(folderId),
        },
      });
    }

    if (labelId) {
      pipeline.push({
        $match: {
          "label._id": ObjectId(labelId),
        },
      });
    }

    if (qrSortBy) {
      let sortStage = {};

      if (qrSortBy === "MoreScans") {
        sortStage = { scanCount: -1 };
      } else if (qrSortBy === "LessScans") {
        sortStage = { scanCount: 1 };
      } else if (qrSortBy === "Recent") {
        sortStage = { createdAt: -1 };
      } else if (qrSortBy === "Name") {
        sortStage = { qrName: 1 };
      }

      pipeline.push({ $sort: sortStage });
    }

    const offset = parseInt(req.query.offset) || 0;
    const limit = parseInt(req.query.limit) || 10;

    const qrs = await QR.aggregate(pipeline);

    // Calculate the totalRecords and totalPages based on the filtered results
    const totalRecords = qrs.length;
    const totalPages = Math.ceil(totalRecords / limit);

    // Apply pagination using slice method
    const startIndex = offset * limit;
    const endIndex = startIndex + limit;
    const paginatedQrs = qrs.slice(startIndex, endIndex);

    res.status(httpStatus.OK).json({
      qrs: paginatedQrs,
      currentPage: Math.floor(offset / limit) + 1,
      totalPages,
      totalRecords,
    });
  } catch (error) {
    return next(error);
  }
};

exports.duplicate = async (req, res, next) => {
  try {
    const sourceDocumentId = req.params.duplicateId;

    const sourceDocument = await QR.findOne({
      _id: ObjectId(sourceDocumentId),
    }).lean();

    // console.log({ sourceDocument });
    if (sourceDocument) {
      // const duplicateDocument = {
      //   ...sourceDocument,
      //   user: req.user.id,
      // };

      const { _id, ...rest } = sourceDocument;
      // console.log("rest", rest);

      // Save the duplicateDocument with the same 'folder' field as an ObjectId
      const duplicatedDocument = new QR(rest);
      console.log(duplicatedDocument);
      await duplicatedDocument.save();

      return res.status(httpStatus.OK).json({
        message: "Document Duplicated Successfully",
      });
    } else {
      return res.status(httpStatus.BAD_REQUEST).json({
        message: "Source document not found",
      });
    }
  } catch (error) {
    console.log("error", error);
    return next(error);
  }
};
