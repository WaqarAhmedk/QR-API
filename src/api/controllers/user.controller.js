const httpStatus = require("http-status");
const { omit } = require("lodash");
const User = require("../models/user.model");
const emailProvider = require("../services/emails/emailProvider");
const moment = require("moment");

/**
 * Load user and append to req.
 * @public
 */
exports.load = async (req, res, next, id) => {
  try {
    const user = await User.get(id);
    req.locals = { user };
    return next();
  } catch (error) {
    return next(error);
  }
};

/**
 * Get user
 * @public
 */
exports.get = (req, res) => res.json(req.locals.user);

/**
 * Get logged in user info
 * @public
 */
exports.loggedIn = (req, res) => res.json(req.user);

/**
 * Create new user
 * @public
 */
exports.create = async (req, res, next) => {
  try {
    const randomPassword = Math.random().toString(36).slice(-8);
    const user = new User({ ...req.body, password: randomPassword });
    const savedUser = await user.save();
    if (savedUser) {
      emailProvider.inviteUser(savedUser, randomPassword);
    }

    const populatedUser = await User.findById(savedUser._id)
      .populate("createdBy", "firstName lastName role _id")
      .exec();

    res.status(httpStatus.CREATED);
    res.json(populatedUser);
  } catch (error) {
    next(User.checkDuplicateEmail(error));
  }
};
exports.searchTeam = async (req, res, next) => {
  try {
    console.log("searchTeam", req.query.searchTerm);
    res.json(req.query.searchTerm);
  } catch (error) {
    next(User.checkDuplicateEmail(error));
  }
};

/**
 * Replace existing user
 * @public
 */
exports.replace = async (req, res, next) => {
  try {
    const { user } = req.locals;
    const newUser = new User(req.body);
    const ommitRole = user.role !== "admin" ? "role" : "";
    const newUserObject = omit(newUser.toObject(), "_id", ommitRole);

    await user.updateOne(newUserObject, { override: true, upsert: true });
    const savedUser = await User.findById(user._id);

    res.json(savedUser);
  } catch (error) {
    next(User.checkDuplicateEmail(error));
  }
};

/**
 * Update existing user
 * @public
 */
exports.update = (req, res, next) => {
  const ommitRole = req.locals.user.role !== "admin" ? "role" : "";
  const updatedUser = omit(req.body, ommitRole);
  const user = Object.assign(req.locals.user, updatedUser);

  user
    .save()
    .then((savedUser) => res.json(savedUser))
    .catch((e) => next(User.checkDuplicateEmail(e)));
};

/**
 * Get user list
 * @public
 */
exports.list = async (req, res, next) => {
  try {
    const createdBy = req.query.userId;
    const users = await User.list({ createdBy });
    return res.send(users);
  } catch (error) {
    next(error);
  }
};

exports.search = async (req, res, next) => {
  try {
    const createdBy = req.params.userId;
    const searchTerm = req.query.searchTerm;
    console.log("user", req);
    const users = await User.find({
      $and: [
        { createdBy: createdBy },
        {
          $or: [
            { email: { $regex: searchTerm, $options: "i" } },
            { firstName: { $regex: searchTerm, $options: "i" } },
            { lastName: { $regex: searchTerm, $options: "i" } },
          ],
        },
      ],
    }).exec();

    return res.send(users);
  } catch (error) {
    next(error);
  }
};
exports.sendOpt = async (req, res, next) => {
  try {
    const id = req.user._id;
    const newEmail = req.body.email;
    const otp = Math.floor(1000 + Math.random() * 9000);
    const otpExpiration = Date.now() + 30 * 60 * 1000;
    const user = await User.findById(id);
    user.otp = otp;
    user.otpExpiration = otpExpiration;
    await user.save();
    emailProvider.updateEmailOPT(newEmail, otp);
    return res
      .status(httpStatus.CREATED)
      .json({ message: "verification email sent successfully" });
  } catch (error) {
    return res.status(400).json({ message: "Could not request Update" });
  }
};
exports.confirmOtp = async (req, res, next) => {
  try {
    const id = req.user._id;
    const otp = req.body.otp;
    const userOtp = req.user.otp;

    const otpExpirationTime = new Date(user.otpExpiration);
    const currentTime = new Date();

    if (userOtp === otp && currentTime < otpExpirationTime) {
      req.body.user.isVerified = true;
      const updatedUser = await User.findByIdAndUpdate(id, req.body.user, {
        new: true,
      });
      return res.status(httpStatus.CREATED).json({
        user: updatedUser,
        message: "User Updated Successfully",
      });
    } else {
      return res.status(400).json({ message: "Invalid or Expired OTP" });
    }
  } catch (error) {
    return res.status(400).json({ message: "Could not request Update" });
  }
};

/**
 * Delete user
 * @public
 */
exports.remove = (req, res, next) => {
  const { user } = req.locals;

  user
    .remove()
    .then(() => res.status(httpStatus.NO_CONTENT).end())
    .catch((e) => next(e));
};

exports.getUserById = async (req, res, next) => {
  try {
    const userId = req.params.userId;
    const user = await User.findById(userId)
      .select("-password")
      .populate(
        "subscriptionId",
        `paymentStatus stripeSubscriptionStatus planName updatedAt`
      );
    return res.json({ user: user });
  } catch (error) {
    return next(error);
  }
};
exports.updateUser = async (req, res, next) => {
  try {
    const userId = req.user;
    let updateduser = await User.findByIdAndUpdate(userId, req.body.data, {
      new: true,
    });
    return res.status(200).json({ user: updateduser });
  } catch (error) {
    console.log("Error in updating user", error);
    return next(error);
  }
};
