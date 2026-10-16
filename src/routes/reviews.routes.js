/**
 * Routes for customer star ratings and reviews of products. Mounted at /api/v1/rating (5
 * endpoints, listed in docs/ENDPOINTS.md).
 *
 * Used by: app.js
 */

// routes/review.routes.js
import express from "express";
import {
  addReview,
  updateReview,
  getAllReviews,
  deleteReview,
  getHomePageReviews,
} from "../controllers/review/review.controller.js";
import auth from "../middlewares/auth.middleware.js";
const router = express.Router();

router.post("/add/:productId", auth, addReview);
router.put("/update/:productId/:reviewId", auth, updateReview);
router.get("/all/:productId", getAllReviews);
router.delete("/delete/:productId/:reviewId", auth, deleteReview);
router.get("/home", getHomePageReviews);
export default router;
