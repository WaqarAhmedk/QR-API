const httpStatus = require("http-status");
const moment = require("moment-timezone");
const { omit } = require("lodash");
const User = require("../models/user.model");
const RefreshToken = require("../models/refreshToken.model");
const PasswordResetToken = require("../models/passwordResetToken.model");
const { jwtExpirationInterval, jwtSecret } = require("../../config/vars");
const jwt = require("jwt-simple");

const APIError = require("../errors/api-error");
const emailProvider = require("../services/emails/emailProvider");
const TokenBlacklist = require("../models/blackListToken.model");
const passport = require("passport");
const google = require("googleapis");
const Folder = require("../models/folder.model");
/**
 * Returns a formated object with tokens
 * @private
 */
function generateTokenResponse(user, accessToken) {
  const tokenType = "Bearer";
  const refreshToken = RefreshToken.generate(user).token;
  const expiresIn = moment().add(jwtExpirationInterval, "days");
  return {
    tokenType,
    accessToken,
    refreshToken,
    expiresIn,
  };
}

/**
 * Returns jwt token if registration was successful
 * @public
 */
exports.register = async (req, res, next) => {
  try {
    const userData = omit(req.body, "role");
    const trialExpirationDate = moment().add(14, "days").toDate();
    const user = await User.create({ ...userData, trialExpirationDate });

    const token = generateTokenResponse(user, user.token());
    emailProvider.SignUpVerification(token, user.email);
    const newFolder = new Folder({ name: "General", owner: user._id });
    const savedFolder = await newFolder.save();
    res.status(httpStatus.CREATED);
    return res.json({ token, user });
  } catch (error) {
    return next(User.checkDuplicateEmail(error));
  }
};

exports.verificationEmail = async (req, res, next) => {
  try {
    const email = req.body.email;
    const user = await User.findOne({ email });
    const token = generateTokenResponse(user, user.token());
    emailProvider.SignUpVerification(token, user.email);
    res.status(httpStatus.CREATED);
    return res.status(200).json({ message: "Verification Email Sent" });
  } catch (error) {
    return res.status(400).json({ message: "Verification Error" });
  }
};

/**
 * Returns jwt token if valid username and password is provided
 * @public
 */
exports.login = async (req, res, next) => {
  try {
    const { user, accessToken } = await User.findAndGenerateToken(req.body);
    if (user.createdBy) {
      if (!user.isVerified) {
        user.isVerified = true;
        user.joiningDate = new Date();
        await user.save();
      }
      const token = generateTokenResponse(user, accessToken);
      return res.json({ token, user: user });
    } else if (!user.createdBy) {
      if (!user.isVerified) {
        return res.status(400).json({ message: "Token is not valid" });
      } else {
        const token = generateTokenResponse(user, accessToken);
        return res.json({ token, user: user });
      }
    }
  } catch (error) {
    return next(error);
  }
};

/**
 * login with an existing user or creates a new one if valid accessToken token
 * Returns jwt token
 * @public
 */
exports.oAuth = async (req, res, next) => {
  try {
    const { user } = req;
    const accessToken = user.token();
    const token = generateTokenResponse(user, accessToken);
    return res.json({ token, user });
  } catch (error) {
    return next(error);
  }
};

/**
 * Returns a new jwt when given a valid refresh token
 * @public
 */
exports.refresh = async (req, res, next) => {
  try {
    const { email, refreshToken } = req.body;
    const refreshObject = await RefreshToken.findOneAndRemove({
      userEmail: email,
      token: refreshToken,
    });
    const { user, accessToken } = await User.findAndGenerateToken({
      email,
      refreshObject,
    });
    const response = generateTokenResponse(user, accessToken);
    return res.json(response);
  } catch (error) {
    return next(error);
  }
};

exports.sendPasswordReset = async (req, res, next) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email }).exec();

    if (user) {
      const passwordResetObj = await PasswordResetToken.generate(user);
      emailProvider.sendPasswordReset(passwordResetObj);
      res.status(httpStatus.OK);
      return res.json("success");
    }
    throw new APIError({
      status: httpStatus.UNAUTHORIZED,
      message: "No account found with that email",
    });
  } catch (error) {
    return next(error);
  }
};

exports.resetPassword = async (req, res, next) => {
  try {
    const { email, password, resetToken } = req.body;
    const resetTokenObject = await PasswordResetToken.findOneAndRemove({
      userEmail: email,
      resetToken,
    });

    const err = {
      status: httpStatus.UNAUTHORIZED,
      isPublic: true,
    };
    if (!resetTokenObject) {
      err.message = "Cannot find matching reset token";
      throw new APIError(err);
    }
    if (moment().isAfter(resetTokenObject.expires)) {
      err.message = "Reset token is expired";
      throw new APIError(err);
    }

    const user = await User.findOne({
      email: resetTokenObject.userEmail,
    }).exec();
    user.password = password;
    await user.save();
    emailProvider.sendPasswordChangeEmail(user);

    res.status(httpStatus.OK);
    return res.json("Password Updated");
  } catch (error) {
    return next(error);
  }
};

exports.logout = async (req, res) => {
  try {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];
    await TokenBlacklist.create({ token });
    return sendResponse(res, "success", 200, "user logged out");
  } catch (error) {
    return res.status(403).json({ message: error });
  }
};

async function validateToken(token) {
  return new Promise((resolve, reject) => {
    passport.authenticate("jwt", { session: true }, (err, user, info) => {
      if (err) {
        return reject(err);
      }
      if (!user) {
        return resolve(false);
      }
      return resolve(true);
    })({ headers: { authorization: `Bearer ${token}` } });
  });
}

exports.verifyToken = async (req, res, next) => {
  try {
    const email = req?.body?.email;
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];
    const verified = await validateToken(token);
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (verified) {
      if (user.isVerified !== true) {
        user.isVerified = true;
        user.joiningDate = new Date();
        await user.save();
      }
      return res.status(httpStatus.OK).json({ message: "Token is valid" });
    } else {
      return res.status(401).json({ message: "Token is not valid" });
    }
  } catch (err) {
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

exports.checkBlacklistedToken = async (req, res, next) => {
  try {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (token) {
      const verified = await validateToken(token);
      if (!verified) {
        throw new APIError({
          status: httpStatus.UNAUTHORIZED,
          message: "token not valid",
        });
      }
      const isBlacklisted = await TokenBlacklist.exists({ token });
      if (isBlacklisted) {
        throw new APIError({
          status: httpStatus.UNAUTHORIZED,
          message: "user black listed",
        });
      }
      res.status(httpStatus.OK);
      return res.json({ message: true });
    }
    throw new APIError({
      status: httpStatus.UNAUTHORIZED,
      message: "No valid user",
    });
  } catch (err) {
    return next(err);
  }
};

const SCOPES = ["email", "profile", "openid"];
exports.googleAuth = async (req, res) => {
  try {
    const { url } = req.query;

    const completeurl = process.env.QR_APP + `${url}`;
    console.log("completeurl 1", completeurl);

    const client_id = process.env.GOOGLE_CLIENT_ID;
    const client_secret = process.env.GOOGLE_CLIENT_SECRET;
    const oauth2Client = new google.google.auth.OAuth2(
      client_id,
      client_secret,
      completeurl
    );
    const authorizeUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES.join(" "),
      prompt: "consent",
    });
    return res.status(200).json(authorizeUrl);
  } catch (err) {
    return res.send({
      error: err.message,
    });
  }
};

exports.googleAuthSuccess = async (req, res, next) => {
  try {
    const client_id = process.env.GOOGLE_CLIENT_ID;
    const client_secret = process.env.GOOGLE_CLIENT_SECRET;

    const { code, url } = req.query;
    const completeurl = process.env.QR_APP + `${url}`;

    const oauth2Client = new google.google.auth.OAuth2(
      client_id,
      client_secret,
      completeurl
    );

    // Use the code to get an access token and refresh token
    const oauth2ClientData = await oauth2Client.getToken(code);
    const oauth2ClientTokens = new google.google.auth.OAuth2(
      client_id,
      client_secret,
      completeurl
    );

    // Set the access token using the refresh token
    oauth2ClientTokens.setCredentials({
      refresh_token: oauth2ClientData.tokens.refresh_token,
    });

    // Call the userinfo API to get the user's information
    const userInfo = await google.google.oauth2("v2").userinfo.get({
      auth: oauth2ClientTokens,
    });

    let existingUser = await User.findOne({
      $or: [{ googleId: userInfo.data.id }, { email: userInfo.data.email }],
    });

    if (!existingUser) {
      const userData = {
        googleId: userInfo.data.id,
        email: userInfo.data.email,
        firstName: userInfo.data.given_name,
        lastName: userInfo.data.family_name,
        picture: userInfo.data.picture,
        isVerified: true,
        role: "admin",
      };

      // Calculate the trial expiration date (14 days from now)
      const trialExpirationDate = moment().add(14, "days").toDate();
      userData.trialExpirationDate = trialExpirationDate;

      const newUser = await new User(userData).save();

      // CREATING INITIAL FOLDER
      const newFolder = new Folder({ name: "General", owner: newUser._id });
      const savedFolder = await newFolder.save();

      let accessToken = createJWTToken(newUser._id);
      let token = generateTokenResponse(newUser, accessToken);
      return res.json({ token, user: newUser });
    } else {
      if (!existingUser.googleId) {
        existingUser.googleId = userInfo.data.id;
        await existingUser.save();
      }
      let accessToken = createJWTToken(existingUser._id);
      let token = generateTokenResponse(existingUser, accessToken);

      return res.json({ token, user: existingUser });
    }
  } catch (err) {
    console.log("error is ", err);
    return next(err);
  }
};

function createJWTToken(userId) {
  const payload = {
    exp: moment().add(jwtExpirationInterval, "hours").unix(),
    iat: moment().unix(),
    sub: userId,
  };
  return jwt.encode(payload, jwtSecret);
}
