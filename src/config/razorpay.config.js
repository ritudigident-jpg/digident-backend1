/**
 * Razorpay client (orders, payments, refunds) from RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET.
 *
 * Used by: services/order/*
 */
import Razorpay from "razorpay";

export const razorpayInstance = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});
