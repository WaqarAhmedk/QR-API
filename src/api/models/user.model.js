const mongoose = require("mongoose");
const httpStatus = require("http-status");
const { omitBy, isNil, stubTrue } = require("lodash");
const bcrypt = require("bcryptjs");
const moment = require("moment-timezone");
const jwt = require("jwt-simple");
const uuidv4 = require("uuid/v4");
const APIError = require("../errors/api-error");
const { env, jwtSecret, jwtExpirationInterval } = require("../../config/vars");
const paginationPlugin = require("./plugins/paginate");
const excludeFieldsPlugin = require("./plugins/transform");

/**
 * User Roles
 */
const roles = [
  "superAdmin",
  "admin",
  "actingAdmin",
  "editor",
  "viewer",
  "whiteLabel",
];

/**
 * User Schema
 * @private
 */
const userSchema = new mongoose.Schema(
  {
    googleId: {
      type: String,
    },
    email: {
      type: String,
      match: /^\S+@\S+\.\S+$/,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    password: {
      type: String,
      minlength: 6,
      maxlength: 128,
    },
    firstName: {
      type: String,
      maxlength: 128,
      index: true,
      trim: true,
    },
    lastName: {
      type: String,
      maxlength: 128,
      index: true,
      trim: true,
    },
    services: {
      facebook: String,
      google: String,
    },
    role: {
      type: String,
      enum: roles,
      default: "admin",
    },
    stripeCustomerId: {
      type: String,
      required: false,
    },
    picture: {
      type: String,
      trim: true,
    },
    createdBy: {
      type: String,
      index: true,
      trim: true,
    },
    status: {
      type: Boolean,
      default: false,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    joiningDate: {
      type: Date,
      default: null,
    },
    otpExpiration: {
      type: Date,
      default: null,
    },
    location: {
      type: String,
      default: String,
    },
    industry: {
      type: String,
      default: String,
    },
    subscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "subscriptions",
    },
    trialExpirationDate: {
      type: Date,
      default: null,
    },
    plan: {
      type: String,
      default: "Free",
    },
    otp: {
      type: Number,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

/**
 * Add your
 * - pre-save hooks
 * - validations
 * - virtuals
 */
userSchema.pre("save", async function save(next) {
  try {
    if (!this.isModified("password")) return next();

    const rounds = env === "test" ? 1 : 10;

    const hash = await bcrypt.hash(this.password, rounds);
    this.password = hash;

    return next();
  } catch (error) {
    return next(error);
  }
});

/**
 * Methods
 */
userSchema.method({
  transform() {
    const transformed = {};
    const fields = [
      "id",
      "firstName",
      "lastName",
      "email",
      "picture",
      "role",
      "createdAt",
      "createdBy",
      "joiningDate",
      "otpExpiration",
      "location",
      "industry",
      "status",
      "isVerified",
      "otp",
    ];

    fields.forEach((field) => {
      transformed[field] = this[field];
    });

    return transformed;
  },

  token() {
    const payload = {
      exp: moment().add(jwtExpirationInterval, "hours").unix(),
      iat: moment().unix(),
      sub: this._id,
    };
    return jwt.encode(payload, jwtSecret);
  },

  async passwordMatches(password) {
    return bcrypt.compare(password, this.password);
  },
});

/**
 * Statics
 */
userSchema.statics = {
  roles,

  /**
   * Get user
   *
   * @param {ObjectId} id - The objectId of user.
   * @returns {Promise<User, APIError>}
   */
  async get(id) {
    let user;

    if (mongoose.Types.ObjectId.isValid(id)) {
      user = await this.findById(id).exec();
    }
    if (user) {
      return user;
    }

    throw new APIError({
      message: "User does not exist",
      status: httpStatus.NOT_FOUND,
    });
  },

  /**
   * Find user by email and tries to generate a JWT token
   *
   * @param {ObjectId} id - The objectId of user.
   * @returns {Promise<User, APIError>}
   */
  async findAndGenerateToken(options) {
    const { email, password, refreshObject } = options;
    if (!email)
      throw new APIError({
        message: "An email is required to generate a token",
      });

    const user = await this.findOne({ email })
      .populate("subscriptionId", ` selectedPlan subscriptionId paymentStatus`)
      .exec();

    if (!user) {
      throw new APIError({
        status: httpStatus.UNAUTHORIZED,
        message: "User Not Found",
      });
    }
    if (!user.password) {
      throw new APIError({
        status: httpStatus.UNAUTHORIZED,
        message: "Email or password Invalid",
      });
    }
    const err = {
      status: httpStatus.UNAUTHORIZED,
      isPublic: true,
    };
    if (password) {
      if (user && (await user.passwordMatches(password))) {
        return { user, accessToken: user.token() };
      }
      err.message = "Incorrect email or password";
    } else if (refreshObject && refreshObject.userEmail === email) {
      if (moment(refreshObject.expires).isBefore()) {
        err.message = "Invalid refresh token.";
      } else {
        return { user, accessToken: user.token() };
      }
    } else {
      err.message = "Incorrect email or refreshToken";
    }
    throw new APIError(err);
  },

  /**
   * List users in descending order of 'createdAt' timestamp.
   *
   * @param {number} skip - Number of users to be skipped.
   * @param {number} limit - Limit number of users to be returned.
   * @returns {Promise<User[]>}
   */
  list({
    page = 1,
    perPage = 30,
    firstName,
    lastName,
    email,
    role,
    createdBy,
  }) {
    const options = omitBy(
      { firstName, lastName, email, role, createdBy },
      isNil
    );

    return this.find(options)
      .sort({ createdAt: -1 })
      .skip(perPage * (page - 1))
      .limit(perPage)
      .populate("createdBy", "firstName lastName email role _id")
      .exec();
  },

  /**
   * Return new validation error
   * if error is a mongoose duplicate key error
   *
   * @param {Error} error
   * @returns {Error|APIError}
   */
  checkDuplicateEmail(error) {
    if (error.name === "MongoError" && error.code === 11000) {
      return new APIError({
        message: "Validation Error",
        errors: [
          {
            field: "email",
            location: "body",
            messages: ["Email already exists"],
          },
        ],
        status: httpStatus.CONFLICT,
        isPublic: true,
        stack: error.stack,
      });
    }
    return error;
  },

  async oAuthLogin({ service, id, email, name, picture }) {
    const user = await this.findOne({
      $or: [{ [`services.${service}`]: id }, { email }],
    });
    if (user) {
      user.services[service] = id;
      if (!user.name) user.name = name;
      if (!user.picture) user.picture = picture;
      return user.save();
    }
    const password = uuidv4();
    return this.create({
      services: { [service]: id },
      email,
      password,
      name,
      picture,
    });
  },
};

userSchema.plugin(paginationPlugin);
userSchema.plugin(excludeFieldsPlugin);
/**
 * @typedef User
 */
module.exports = mongoose.model("User", userSchema);
