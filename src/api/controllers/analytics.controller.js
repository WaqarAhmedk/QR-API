const httpStatus = require("http-status");
const QR = require("../models/qr.model");
const Analytics = require("../models/analytics.model");
const APIError = require("../errors/api-error");
const { Types } = require("mongoose");
const User = require("../models/user.model");

exports.create = async (req, res, next) => {
  try {
    const qr = await QR.get(req.body.qrId);
    if (!qr) {
      throw new APIError({
        message: "QR Not Found",
        status: httpStatus.NOT_FOUND,
      });
    }
    const analytics = new Analytics({ ...req.body });
    const savedAnalytics = await analytics.save();
    res.status(httpStatus.CREATED);
    res.json(savedAnalytics);
  } catch (error) {
    return next(error);
  }
};

exports.getScanCountByGroup = async (req, res) => {
  try {
    const result = await Analytics.aggregate(req.query);
    res.status(httpStatus.OK);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

exports.getScanCount = async (req, res, next) => {
  try {
    const count = await Analytics.countDocuments(req.query);
    res.status(httpStatus.OK);
    res.json(count);
  } catch (error) {
    next(error);
  }
};

exports.getAnalytics = async (req, res, next) => {
  try {
    const result = await Analytics.aggregate(req.query);
    res.status(httpStatus.OK);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

// Define a function to aggregate QR scans based on time periods
exports.qrScansByTimePeriod = async (req, res, next) => {
  const { timePeriod, userId, qrId } = req.query;
  const current = req.user;

  let match1 = {};
  if (userId) {
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
    const userQRs = await QR.find({ user: userIds }).select("_id");
    const qrIds = userQRs.map((qr) => Types.ObjectId(qr._id));
    match1 = { qrId: { $in: qrIds } };
  } else {
    match1 = { qrId: Types.ObjectId(qrId) };
  }
  let format = "";
  const currentDate = new Date();
  let startDate;
  let match2 = {};
  switch (timePeriod) {
    case "hour":
      format = "%Y-%m-%d %H";
      startDate = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth(),
        currentDate.getDate() - 1,
        currentDate.getHours(),
        0,
        0,
        0
      );
      break;
    case "day":
      format = "%Y-%m-%d";
      startDate = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth(),
        currentDate.getDate() - 7
      );
      break;

    case "month":
      format = "%Y-%m";
      startDate = new Date(
        currentDate.getFullYear() - 1,
        currentDate.getMonth(),
        1
      );
      break;

    case "year":
      format = "%Y";
      startDate = new Date(
        currentDate.getFullYear() - 7,
        currentDate.getMonth(),
        1
      );
      break;
  }
  if (startDate) match2 = { createdAt: { $gte: startDate, $lte: currentDate } };

  let match = {
    $match: {
      $and: [match1, match2],
    },
  };
  const pipeline = [
    { ...match },
    {
      $group: {
        _id: {
          $dateToString: {
            date: "$createdAt",
            format: format,
          },
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ];

  try {
    const result = await Analytics.aggregate(pipeline);
    res.status(httpStatus.OK);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

exports.analyticsData = async (req, res, next) => {
  try {
    const { userId, qrId } = req.query;
    const current = req.user;

    let match = {};
    if (userId) {
      // Get the list of QR IDs for the user
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
      // Get the list of QR IDs for the user
      const userQRs = await QR.find({ user: userIds }).select("_id");

      const qrIds = userQRs.map((qr) => Types.ObjectId(qr._id));
      match = { $match: { qrId: { $in: qrIds } } };
    } else {
      match = { $match: { qrId: Types.ObjectId(qrId) } };
    }

    const devicesResult = await Analytics.aggregate([
      { ...match },
      { $group: { _id: "$device", count: { $sum: 1 } } },
    ]);
    const locationsResult = await Analytics.aggregate([
      { ...match },
      { $group: { _id: "$location.city", count: { $sum: 1 } } },
    ]);

    const browsersResult = await Analytics.aggregate([
      { ...match },
      { $group: { _id: "$browser", count: { $sum: 1 } } },
    ]);

    // Transform the data into the desired format
    const devices = devicesResult.reduce((acc, { _id, count }) => {
      acc[_id] = count;
      return acc;
    }, {});

    const locations = locationsResult.reduce((acc, { _id, count }) => {
      acc[_id] = count;
      return acc;
    }, {});

    const browsers = browsersResult.reduce((acc, { _id, count }) => {
      acc[_id] = count;
      return acc;
    }, {});

    // Create the final response object
    const responseData = {
      devices,
      locations,
      browsers,
    };

    // Return the response
    res.json(responseData);
  } catch (error) {
    return next(error);
  }
};
