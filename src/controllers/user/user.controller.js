/**
 * HTTP handlers for shop customers: register, verify e-mail, login (password, Google, Microsoft),
 * profile: read the request, call the service, send the response. No business logic here.
 *
 * Exports: registerUser, loginUser, verifyEmail, logoutUser, refreshAccessToken, googleAuth,
 * googleCallback, microsoftAuth and 11 more
 * Used by: routes/users.routes.js
 */

import { sendSuccess, sendCreated } from "../../helpers/response.helper.js";

import {
  registerUserService,
  loginUserService,
  verifyEmailService,
  forgotPasswordService,
  resetPasswordService,
  refreshAccessTokenService,
  updateUserProfileService,
  getUserDashboardService,
  changePasswordService,
} from "../../services/user/user.service.js";
import {
  validateRegisterBody,
  validateLoginBody,
  validateResetPasswordBody,
  validateChangePasswordBody,
} from "./user.validator.js";
import passport from "passport";
import { getPagination } from "../../helpers/pagination.helper.js";
import User from "../../models/user.model.js";
import { generateTokens } from "../../helpers/token.helper.js";
import { sendNotification } from "../../services/notification/notification.service.js";
import {
  BadRequestError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../../helpers/apperror.helper.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import { asyncHandler } from "../../helpers/asynchandler.helper.js";
import { logger } from "../../helpers/logger.helper.js";

/**
 * @function registerUser
 *
 * @params
 * body: {
 *   firstName: string,
 *   lastName: string,
 *   email: string,
 *   password: string,
 *   instituteName: string
 * }
 *
 * @process
 * 1. Validate required request fields
 * 2. Check if user already exists using email
 * 3. Create a new user record
 * 4. Generate email verification token
 * 5. Save verification token with expiry
 * 6. Send verification email to user
 * 7. Return success response
 *
 * @response
 * 201 { success: true, message: "Registered Successfully! Check your email to verify your account." }
 */
export const registerUser = asyncHandler(async (req, res) => {
  const { value, error } = validateRegisterBody(req.body);
  if (error) {
    throw ValidationError.fromJoi(error);
  }
  const user = await registerUserService(value);
  return sendCreated(res, {
    data: { userId: user.userId },
    message: "Registered successfully. Please verify your email.",
  });
});

/**
 * @function loginUser
 *
 * @params
 * body: {
 *   email: string,
 *   password: string
 * }
 *
 * @process
 * 1. Validate required request fields (email and password)
 * 2. Normalize email (convert to lowercase and trim spaces)
 * 3. Find user by email and include password field
 * 4. Check if user exists
 * 5. Verify if user's email is verified
 * 6. Check if the user account is active
 * 7. Compare entered password with hashed password using bcrypt
 * 8. Generate accessToken and refreshToken
 * 9. Store refreshToken in HTTP-only cookie
 * 10. Return accessToken and user basic information
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Login successful",
 *   data: {
 *     accessToken: string,
 *     user: {
 *       userId: string,
 *       firstName: string,
 *       lastName: string,
 *       email: string,
 *       instituteName: string
 *     }
 *   }
 * }
 */
export const loginUser = asyncHandler(async (req, res) => {
  const { value, error } = validateLoginBody(req.body);
  if (error) {
    throw ValidationError.fromJoi(error);
  }
  const { accessToken, refreshToken, user } = await loginUserService(value);
  // store refresh token in cookie
  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: "None",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  return sendSuccess(res, { data: { accessToken, user }, message: "Login successfull" });
});

/**
 * @function verifyEmail
 *
 * @params
 * params: {
 *   token: string
 * }
 *
 * @process
 * Validate that verification token is provided in request params
 * Find user using emailVerificationToken.token and check token expiration
 * Return error if token is invalid or expired
 * Mark user email as verified
 * Remove email verification token from user record
 * Save updated user in database
 * Return success response after successful verification
 *
 * @response
 * 200 { success: true, message: "Email verified successfully! You can now log in." }
 */
export const verifyEmail = asyncHandler(async (req, res) => {
  const { token } = req.params;
  if (!token) {
    throw new BadRequestError("Verification token is required", { code: ERROR_CODES.TOKEN_REQUIRED });
  }
  await verifyEmailService(token);
  return sendSuccess(res, { data: null, message: "Email verified successfully! You can now log in." });
});

/**
 * @function logoutUser
 *
 * @params
 * cookies: {
 *   refreshToken: string,
 *   accessToken: string
 * }
 *
 * @process
 * Clear refresh token stored in browser cookies
 * Clear access token cookie if present
 * Invalidate user session on the client side
 * Return success response confirming logout
 *
 * @response
 * 200 { success: true, message: "Logged out successfully" }
 */
export const logoutUser = asyncHandler(async (req, res) => {
  res.clearCookie("refreshToken", {
    httpOnly: true,
    secure: true,
    sameSite: "None",
    path: "/",
  });

  res.clearCookie("accessToken", {
    httpOnly: true,
    secure: true,
    sameSite: "None",
    path: "/",
  });
  return sendSuccess(res, { data: null, message: "Logged out successfully" });
});

/**
 * @function refreshAccessToken
 *
 * @params
 * cookies: {
 *   refreshToken: string
 * }
 *
 * @process
 * Retrieve refresh token from request cookies
 * Validate that refresh token exists
 * Verify refresh token using JWT secret
 * Extract userId from decoded token payload
 * Find user in database using userId
 * Return error if user does not exist
 * Generate a new access token for the user
 * Return success response with the new access token
 *
 * @response
 * 200 { success: true, message: "Access token refreshed successfully", data: { accessToken: string } }
 */
export const refreshAccessToken = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies?.refreshToken;
  if (!refreshToken) {
    throw new UnauthorizedError("Refresh token is required", { code: ERROR_CODES.REFRESH_TOKEN_MISSING });
  }
  const accessToken = await refreshAccessTokenService(refreshToken);
  return sendSuccess(res, { data: { accessToken }, message: "Access token refreshed successfully" });
});

/**
 * @function googleAuth
 *
 * @params
 * none
 *
 * @process
 * Initiate Google OAuth authentication using Passport
 * Redirect user to Google consent screen
 * Request access to user's profile and email information
 * After successful authentication Google redirects back to the application callback URL
 *
 * @response
 * Redirects user to Google authentication page
 */
export const googleAuth = passport.authenticate("google", {
  scope: ["profile", "email"],
});

/**
 * @function googleCallback
 *
 * @params
 * query: OAuth response from Google
 *
 * @process
 * Authenticate user using Google OAuth strategy through Passport
 * Handle authentication errors and redirect user to login page if authentication fails
 * Retrieve authenticated user returned by Passport
 * Generate access token and refresh token for the authenticated user
 * Store refresh token in secure HTTP-only cookie
 * Redirect user to frontend OAuth success page with the access token
 *
 * @response
 * Redirects user to frontend success page after successful authentication
 */
export const googleCallback = (req, res, next) => {
  passport.authenticate("google", { session: false }, async (err, user) => {
    try {
      if (err || !user) {
        return res.redirect(`${process.env.FRONTEND_URL}/login?error=google-failed`);
      }
      const { accessToken, refreshToken } = generateTokens(user);
      res.cookie("refreshToken", refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: "None",
        path: "/",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
      return res.redirect(`${process.env.FRONTEND_URL}/oauth-success?accessToken=${accessToken}`);
    } catch (error) {
      logger.error("Google Callback Error", { error });
      return res.redirect(`${process.env.FRONTEND_URL}/login?error=server-error`);
    }
  })(req, res, next);
};

/**
 * @function microsoftAuth
 *
 * @params
 * none
 *
 * @process
 * Initiate Microsoft OAuth authentication using Passport
 * Request permission to access user's basic profile information
 * Redirect user to Microsoft login and consent screen
 * After successful authentication Microsoft redirects user to the callback URL
 *
 * @response
 * Redirects user to Microsoft authentication page
 */
export const microsoftAuth = passport.authenticate("microsoft", {
  scope: ["user.read"],
});

/**
 * @function microsoftCallback
 *
 * @params
 * query: OAuth response from Microsoft
 *
 * @process
 * Authenticate user using Microsoft OAuth strategy through Passport
 * Handle authentication errors and redirect user to login page if authentication fails
 * Retrieve authenticated user returned by Passport
 * Generate access token and refresh token for the authenticated user
 * Store refresh token in secure HTTP-only cookie
 * Redirect user to frontend OAuth success page with the access token
 *
 * @response
 * Redirects user to frontend success page after successful authentication
 */
export const microsoftCallback = (req, res, next) => {
  passport.authenticate("microsoft", { session: false }, async (err, user) => {
    try {
      if (err || !user) {
        logger.error("Microsoft auth error", { error: err });
        return res.redirect(`${process.env.FRONTEND_URL}/login?error=microsoft-failed`);
      }
      const { accessToken, refreshToken } = generateTokens(user);
      res.cookie("refreshToken", refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: "None",
        path: "/",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
      return res.redirect(`${process.env.FRONTEND_URL}/oauth-success?accessToken=${accessToken}`);
    } catch (error) {
      logger.error("Microsoft Callback Error", { error });
      return res.redirect(`${process.env.FRONTEND_URL}/login?error=server-error`);
    }
  })(req, res, next);
};

/**
 * @function getAllUsers
 *
 * @params
 * query: {
 *   page?: number,
 *   limit?: number
 * }
 *
 * @process
 * Retrieve pagination values using shared pagination utility
 * Fetch users from database while excluding password field
 * Count total number of users
 * Return paginated users with pagination metadata
 *
 * @response
 * 200 { success: true, message: "Users fetched successfully", data: { users, pagination } }
 */
export const getAllUsers = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const users = await User.find().select("-password").skip(skip).limit(limit).lean();
  const totalUsers = await User.countDocuments();

  const totalPages = Math.ceil(totalUsers / limit);
  return sendSuccess(res, {
    data: {
      users,
      pagination: {
        totalItems: totalUsers,
        totalPages,
        currentPage: page,
        nextPage: page < totalPages ? page + 1 : null,
        prevPage: page > 1 ? page - 1 : null,
        limit,
      },
    },
    message: "Users fetched successfully",
  });
});

/**
 * @function deleteUserById
 *
 * @params
 * params: {
 *   userId: string
 * }
 *
 * @process
 * Retrieve userId from request parameters
 * Validate that userId is provided
 * Find and delete the user from database using userId
 * Return error if user does not exist
 * Return success response after successful deletion
 *
 * @response
 * 200 { success: true, message: "User deleted successfully", data: { userId } }
 */
export const deleteUserById = asyncHandler(async (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    throw new BadRequestError("userId is required", { code: ERROR_CODES.USER_ID_REQUIRED });
  }

  const deletedUser = await User.findOneAndDelete({ userId });

  if (!deletedUser) {
    throw new NotFoundError("User not found", { code: ERROR_CODES.USER_NOT_FOUND });
  }
  /* ---------- SEND NOTIFICATION ---------- */
  try {
    await sendNotification({
      permission: "customer.listing.read",
      title: "User Account Deleted",
      message: `${deletedUser.firstName} ${deletedUser.lastName} deleted their account`,
      type: "USER_DELETED",
      entityId: deletedUser._id,
      entityModel: "User",
      metadata: {
        userId: deletedUser.userId,
        fullName: `${deletedUser.firstName} ${deletedUser.lastName}`,
        email: deletedUser.email,
        instituteName: deletedUser.instituteName || null,
      },
    });
  } catch (notifyErr) {
    logger.error("Notification failed", { error: notifyErr.message });
  }
  return sendSuccess(res, { data: { userId }, message: "User deleted successfully" });
});

/**
 * @function forgotPassword
 *
 * @params
 * body: {
 *   email: string
 * }
 *
 * @process
 * Retrieve email from request body
 * Validate that email is provided
 * Call forgot password service
 * Send password reset link to user email
 * Return success response
 *
 * @response
 * 200 { success: true, message: "Password reset link sent to your email" }
 */

export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    throw new BadRequestError("Email is required", { code: ERROR_CODES.EMAIL_REQUIRED });
  }

  await forgotPasswordService(email);

  return sendSuccess(res, { data: null, message: "Password reset link sent to your email" });
});

/**
 * @function resetPassword
 *
 * @params
 * params: {
 *   token: string
 * }
 *
 * body: {
 *   newPassword: string,
 *   confirmNewPassword: string
 * }
 *
 * @process
 * Validate request body using Joi
 * Retrieve reset token from request parameters
 * Call reset password service with token and new password
 * Update user password if token is valid
 * Return success response
 *
 * @response
 * 200 { success: true, message: "Password reset successfully. Please login again." }
 */

export const resetPassword = asyncHandler(async (req, res) => {
  const { value, error } = validateResetPasswordBody(req.body);
  if (error) {
    throw ValidationError.fromJoi(error);
  }
  const { token } = req.params;
  if (!token) {
    throw new BadRequestError("Invalid or missing token");
  }
  await resetPasswordService(token, value.newPassword);
  return sendSuccess(res, { data: null, message: "Password reset successfully. Please login again." });
});

/**
 * @function getUserDashboard
 *
 * @params
 * user: {
 *   email: string
 * }
 *
 * @process
 * Retrieve authenticated user's email from request object
 * Validate user authorization
 * Call dashboard service to fetch user data
 * Return user profile, addresses, orders and cart data
 *
 * @response
 * 200 { success: true, message: "Dashboard fetched successfully", data: dashboard }
 */

export const getUserDashboard = asyncHandler(async (req, res) => {
  const userEmail = req.user?.email;
  if (!userEmail) {
    throw new UnauthorizedError("Unauthorized");
  }
  const dashboard = await getUserDashboardService(userEmail);
  return sendSuccess(res, { data: dashboard, message: "Dashboard fetched successfully" });
});

/**
 * @function updateUserProfile
 *
 * @params
 * user: {
 *   email: string
 * }
 *
 * body: {
 *   firstName?: string,
 *   lastName?: string,
 *   instituteName?: string,
 *   phone?: string
 * }
 *
 * files: {
 *   avatar?: File
 * }
 *
 * @process
 * Retrieve authenticated user email from request
 * Validate user authorization
 * Call update profile service
 * Return updated user profile
 *
 * @response
 * 200 { success: true, message: "Profile updated successfully", data: user }
 */

export const updateUserProfile = asyncHandler(async (req, res) => {
  const userEmail = req.user?.email;

  if (!userEmail) {
    throw new UnauthorizedError("Unauthorized");
  }

  const updatedUser = await updateUserProfileService(userEmail, req.body, req.files);

  return sendSuccess(res, { data: { user: updatedUser }, message: "Profile updated successfully" });
});

/**
 * @function getUserById
 *
 * @params
 * params: {
 *   userId: string
 * }
 *
 * @process
 * Retrieve userId from request params
 * Find user in database using userId
 * Exclude sensitive fields like password and tokens
 * Return user data if found
 *
 * @response
 * 200 { success: true, message: "User fetched successfully", data: user }
 */

export const getUserById = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  if (!userId) {
    throw new BadRequestError("UserId is required");
  }
  const user = await User.findOne({ userId }).select(
    "-_id -password -resetPasswordToken -resetPasswordExpiresAt -emailVerificationToken -__v"
  );
  if (!user) {
    throw new NotFoundError("User not found");
  }
  return sendSuccess(res, { data: user, message: "User fetched successfully" });
});

/**
 * @function getCurrentUser
 *
 * @params
 * user: {
 *   email: string
 * }
 *
 * @process
 * Retrieve authenticated user's email from request
 * Find user in database using email
 * Select only required fields
 * Return formatted user data
 *
 * @response
 * 200 { success: true, message: "User details fetched successfully", data: user }
 */

export const getCurrentUser = asyncHandler(async (req, res) => {
  const { email } = req.user;
  if (!email) {
    throw new UnauthorizedError("Unauthorized");
  }
  const user = await User.findOne({ email }).select("firstName lastName email avatar");
  if (!user) {
    throw new NotFoundError("User not found");
  }
  return sendSuccess(res, {
    data: {
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      avatar: user.avatar || "",
    },
    message: "User details fetched successfully",
  });
});

/**
 * @function changePassword
 *
 * @params
 * body: {
 *   oldPassword: string,
 *   newPassword: string
 * }
 *
 * @process
 * Validate old and new password
 * Fetch authenticated user from database
 * Compare old password with stored password
 * Update password if valid
 * Invalidate existing refresh token
 *
 * @response
 * 200 { success: true, message: "Password changed successfully. Please log in again." }
 */

export const changePassword = asyncHandler(async (req, res) => {
  const { value, error } = validateChangePasswordBody(req.body);

  if (error) {
    throw ValidationError.fromJoi(error);
  }

  const { oldPassword, newPassword } = value;

  await changePasswordService(req.user.id, oldPassword, newPassword);

  return sendSuccess(res, { data: null, message: "Password changed successfully. Please log in again." });
});

/**
 * @function deleteAllUsers
 *
 * @process
 * Prevent execution in production environment
 * Delete all users from database
 * Return number of deleted records
 *
 * @response
 * 200 { success: true, message: "All user data deleted successfully", data: { deletedCount } }
 */

export const deleteAllUsers = asyncHandler(async (req, res) => {
  const result = await User.deleteMany({});
  return sendSuccess(res, {
    data: { deletedCount: result.deletedCount },
    message: "All user data deleted successfully",
  });
});
