/**
 * Loads the logged-in shop customer from the database into req.user.
 *
 * Exports: attachUser
 * Used by: routes/addresses.routes.js, routes/carts.routes.js, routes/orders.routes.js
 */

import User from "../models/user.model.js";
import { ERROR_CODES } from "../constants/errorcodes.constant.js";
import { NotFoundError, UnauthorizedError } from "../helpers/apperror.helper.js";
import { asyncHandler } from "../helpers/asynchandler.helper.js";

/**
 * @function attachUser
 *
 * @description
 * Middleware to attach the authenticated user to the request object.
 * Ensures the user exists and is active.
 *
 * @process
 * 1. Check if `req.user.email` exists (from verified JWT)
 * 2. Fetch the user from the database where `isActive` is true and not deleted
 * 3. If the user does not exist, return 404 using `errorResponse`
 * 4. Attach the user to `req.currentUser`
 * 5. Call `next()` to continue
 *
 * @response
 * 401 { success: false, message: "Unauthorized" } - if JWT payload missing email
 * 404 { success: false, message: "User not found" } - if user is not active or deleted
 * 500 { success: false, message: "Internal Server Error", error: "<error_message>" } - for any server error
 */

export const attachUser = asyncHandler(async (req, res, next) => {
  /* =========================
       CHECK USER FROM TOKEN
    ========================= */
  const email = req.user?.email;

  if (!email) {
    throw new UnauthorizedError("Unauthorized", { code: ERROR_CODES.UNAUTHORIZED });
  }

  /* =========================
       FETCH USER
    ========================= */
  const user = await User.findOne({
    email,
    isActive: true,
    deletedAt: null,
  });

  if (!user) {
    throw new NotFoundError("User not found", { code: ERROR_CODES.USER_NOT_FOUND });
  }

  /* =========================
       ATTACH USER
    ========================= */
  req.currentUser = user;

  next();
});
