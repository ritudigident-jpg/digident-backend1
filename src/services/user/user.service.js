/**
 * Business logic for shop customers: register, verify e-mail, login (password, Google, Microsoft),
 * profile. Throws AppError subclasses on failure.
 *
 * Exports: registerUserService, loginUserService, verifyEmailService, refreshAccessTokenService,
 * forgotPasswordService, resetPasswordService, getUserDashboardService, updateUserProfileService
 * and 1 more
 * Used by: controllers/user/user.controller.js
 */

import User from "../../models/user.model.js";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { v6 as uuidv6 } from "uuid";
import { generateTokens } from "../../helpers/token.helper.js";
import { verifyEmailTemplate } from "../../templates/email/verifyuseremail.template.js";
import { resetPasswordTemplate } from "../../templates/email/resetpassword.template.js";
import { sendZohoMail } from "../zoho/zohomail.service.js";
import jwt from "jsonwebtoken";
import { uploadToS3, deleteFromS3 } from "../aws/aws.service.js";
import { sendNotification } from "../notification/notification.service.js";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from "../../helpers/apperror.helper.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import { logger } from "../../helpers/logger.helper.js";

// REGISTER
/**
 * Register user.
 *
 * @param {*} data
 * @returns {Promise<*>}
 * @throws {ConflictError} 409 when the record already exists or was already processed.
 */
export const registerUserService = async (data) => {
  const { firstName, lastName, email, password, instituteName } = data;
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw new ConflictError("This email already exist.");
  }
  const user = await User.create({
    userId: uuidv6(),
    firstName,
    lastName,
    email,
    password,
    instituteName,
  });
  const token = crypto.randomBytes(32).toString("hex");
  user.emailVerificationToken = {
    token,
    expiresAt: Date.now() + 15 * 60 * 1000,
  };
  await user.save();
  const verifyUrl = `${process.env.FRONTEND_URL}/verify-email/${token}`;
  const htmlBody = verifyEmailTemplate(verifyUrl, firstName);
  await sendZohoMail(email, "Verify your Email", htmlBody);
  /* ---------- SEND NOTIFICATION ---------- */
  try {
    await sendNotification({
      permission: "customer.listing.read",
      title: "New User Registered",
      message: `${firstName} ${lastName} has registered successfully`,
      type: "USER_REGISTERED",
      entityId: user._id,
      entityModel: "User",
      metadata: {
        userId: user.userId,
        fullName: `${firstName} ${lastName}`,
        email: user.email,
        instituteName: user.instituteName || null,
      },
    });
  } catch (notifyErr) {
    logger.error("Notification failed", { error: notifyErr.message });
  }
  return user;
};

// LOGIN
/**
 * Login user.
 *
 * @param {*} data
 * @returns {Promise<*>}
 * @throws {BadRequestError} 400 when the input breaks a rule.
 * @throws {ForbiddenError} 403 when the caller may not do this.
 * @throws {UnauthorizedError} 401 when the caller is not logged in or the credentials are wrong.
 */
export const loginUserService = async (data) => {
  const { email, password } = data;
  const normalizedEmail = email.toLowerCase().trim();
  const user = await User.findOne({ email: normalizedEmail }).select("+password");
  if (!user) {
    throw new BadRequestError("Invalid email, Enter a correct Email");
  }
  if (!user.emailVerified) {
    throw new ForbiddenError("Please verify your email first");
  }
  if (!user.isActive) {
    throw new ForbiddenError("Your account is deactivated");
  }
  const isPasswordMatch = await bcrypt.compare(password, user.password);
  if (!isPasswordMatch) {
    throw new UnauthorizedError("Incorrect password, Enter correct password.");
  }
  const { accessToken, refreshToken } = generateTokens(user);
  return {
    accessToken,
    refreshToken,
    user: {
      userId: user.userId,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      instituteName: user.instituteName,
    },
  };
};

// VERIFY EMAIL
/**
 * Verify email.
 *
 * @param {*} token
 * @returns {Promise<*>}
 * @throws {BadRequestError} 400 when the input breaks a rule.
 */
export const verifyEmailService = async (token) => {
  const user = await User.findOne({
    "emailVerificationToken.token": token,
    "emailVerificationToken.expiresAt": { $gt: Date.now() },
  });
  if (!user) {
    throw new BadRequestError("Invalid or expired verification link");
  }
  user.emailVerified = true;
  // clear token after successful verification
  user.emailVerificationToken = undefined;
  await user.save();
  return user;
};

/**
 * Refresh access token.
 *
 * @param {*} refreshToken
 * @returns {Promise<*>}
 * @throws {UnauthorizedError} 401 when the caller is not logged in or the credentials are wrong.
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const refreshAccessTokenService = async (refreshToken) => {
  let decoded;
  try {
    decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
  } catch (error) {
    throw new UnauthorizedError("Invalid or expired refresh token", {
      code: ERROR_CODES.INVALID_OR_EXPIRED_REFRESH_TOKEN,
    });
  }
  const user = await User.findOne({ userId: decoded.id });
  if (!user) {
    throw new NotFoundError("User not found. Please login again");
  }
  const { accessToken } = generateTokens(user);
  return accessToken;
};

/**
 * Forgot password.
 *
 * @param {*} email
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const forgotPasswordService = async (email) => {
  const user = await User.findOne({ email });
  if (!user) {
    throw new NotFoundError("User not found", { code: ERROR_CODES.USER_NOT_FOUND });
  }
  const resetToken = crypto.randomBytes(32).toString("hex");
  user.resetPasswordToken = resetToken;
  user.resetPasswordExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await user.save();
  const resetURL = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;
  await sendZohoMail(email, "Reset Password", resetPasswordTemplate(resetURL, user.firstName));
  return true;
};

/**
 * Reset password.
 *
 * @param {*} token
 * @param {*} newPassword
 * @returns {Promise<*>}
 * @throws {UnauthorizedError} 401 when the caller is not logged in or the credentials are wrong.
 */
export const resetPasswordService = async (token, newPassword) => {
  const user = await User.findOne({
    resetPasswordToken: token,
    resetPasswordExpiresAt: { $gt: Date.now() },
  }).select("+password");
  if (!user) {
    throw new UnauthorizedError("Invalid or expired reset token");
  }
  user.password = newPassword;
  user.passwordChangedAt = new Date();
  user.resetPasswordToken = undefined;
  user.resetPasswordExpiresAt = undefined;
  await user.save();
  return true;
};

/**
 * Get user dashboard.
 *
 * @param {*} email
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const getUserDashboardService = async (email) => {
  const user = await User.findOne({ email })
    .select("-password -resetPasswordToken -resetPasswordExpiresAt -emailVerificationToken ")
    .populate({
      path: "orderHistory.orderId",
      select: "orderId orderStatus paymentStatus grandTotal items createdAt iId",
    })
    .populate({
      path: "cart",
    })
    .lean();
  if (!user || user.deletedAt) {
    throw new NotFoundError("User not found", { code: ERROR_CODES.USER_NOT_FOUND });
  }
  return user;
};

/**
 * Update user profile.
 *
 * @param {*} email
 * @param {*} updates
 * @param {*} files
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 * @throws {ForbiddenError} 403 when the caller may not do this.
 * @throws {BadRequestError} 400 when the input breaks a rule.
 */
export const updateUserProfileService = async (email, updates, files) => {
  const user = await User.findOne({ email }).select(
    "-password -resetPasswordToken -resetPasswordExpiresAt -emailVerificationToken -__v"
  );
  if (!user) {
    throw new NotFoundError("User not found", { code: ERROR_CODES.USER_NOT_FOUND });
  }
  if (updates.password) {
    throw new ForbiddenError("Password update not allowed", {
      code: ERROR_CODES.PASSWORD_UPDATE_NOT_ALLOWED,
    });
  }
  /* ---------------- PHONE UPDATE ---------------- */
  if (updates.phone && updates.phone !== user.phone) {
    user.phone = updates.phone;
    user.phoneVerified = false;
  }
  /* ---------------- AVATAR UPLOAD ---------------- */
  if (files?.avatar?.length) {
    const newFile = files.avatar[0];
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(newFile.mimetype)) {
      throw new BadRequestError("Invalid image type", { code: ERROR_CODES.INVALID_IMAGE_TYPE });
    }
    const uploaded = await uploadToS3(newFile, "user/profile");
    if (user.avatar) {
      try {
        await deleteFromS3(user.avatar);
      } catch (err) {
        logger.error("Old avatar delete failed", { error: err.message });
      }
    }
    user.avatar = uploaded.url;
  }
  /* ---------------- OTHER FIELDS ---------------- */
  const allowedFields = ["firstName", "lastName", "instituteName"];
  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      user[field] = updates[field];
    }
  }
  await user.save();
  return user;
};

/**
 * Change password.
 *
 * @param {*} userId
 * @param {*} oldPassword
 * @param {*} newPassword
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 * @throws {UnauthorizedError} 401 when the caller is not logged in or the credentials are wrong.
 */
export const changePasswordService = async (userId, oldPassword, newPassword) => {
  const user = await User.findOne(userId).select("+password");
  if (!user) {
    throw new NotFoundError("User not found", { code: ERROR_CODES.USER_NOT_FOUND });
  }
  const isMatch = await bcrypt.compare(oldPassword, user.password);
  if (!isMatch) {
    throw new UnauthorizedError("Old password is incorrect", { code: ERROR_CODES.INVALID_OLD_PASSWORD });
  }
  user.password = newPassword;
  user.passwordChangedAt = new Date();
  user.refreshToken = null;
  await user.save();
  return true;
};
