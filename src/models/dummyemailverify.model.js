/**
 * Mongoose model "EmailVerifyDummy": pending OTP / e-mail verifications.
 *
 * Used by: controllers/librarylog/librarylog.controller.js,
 * services/librarylog/librarylog.service.js
 */

import mongoose from "mongoose";

const emailVerifyDummySchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
    },
    otp: {
      type: String,
      required: true,
    },
    otpExpiry: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true }
);
export default mongoose.model("EmailVerifyDummy", emailVerifyDummySchema);
