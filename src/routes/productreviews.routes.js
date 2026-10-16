/**
 * Routes for product-type feedback forms (Scan Body, Lab Analog, Screws, Abutment ...). Mounted at
 * /api/v1/product-review (5 endpoints, listed in docs/ENDPOINTS.md).
 *
 * Used by: app.js
 */

import express from "express";
import {
  createProductReview,
  getAllProductReviews,
  getProductReviewById,
  updateProductReview,
  deleteProductReview,
} from "../controllers/productreview/productreview.controller.js";

const router = express.Router();
router.post("/create", createProductReview);
router.get("/get-all", getAllProductReviews);
router.get("/get/:reviewId", getProductReviewById);
router.put("/update/:reviewId", updateProductReview);
router.delete("/delete/:reviewId", deleteProductReview);

export default router;
