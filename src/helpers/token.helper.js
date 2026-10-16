/**
 * Creates JWT access and refresh tokens.
 *
 * Exports: generateTokens
 * Used by: controllers/user/user.controller.js, services/employee/employee.service.js,
 * services/user/user.service.js
 */

import jwt from "jsonwebtoken";

/**
 * Generate tokens.
 *
 * @param {*} user
 * @returns {*}
 */
export const generateTokens = (user) => {
  const accessToken = jwt.sign(
    {
      id: user.userId,
      email: user.email,
    },
    process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: "1d" }
  );

  const refreshToken = jwt.sign(
    {
      id: user.userId,
      email: user.email,
    },
    process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: "7d" }
  );
  return { accessToken, refreshToken };
};
