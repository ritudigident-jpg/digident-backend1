/**
 * Routes for customer testimonials shown on the website. Mounted at /api/v1/testimonial (5
 * endpoints, listed in docs/ENDPOINTS.md).
 *
 * Used by: app.js
 */

import express from "express";
import {
  createTestimonial,
  getAllTestimonials,
  getTestimonialById,
  updateTestimonial,
  deleteTestimonial,
} from "../controllers/testimonial/testimonial.controller.js";

const router = express.Router();

router.post("/create", createTestimonial);
router.get("/get-all", getAllTestimonials);
router.get("/get/:testimonialId", getTestimonialById);
router.put("/update/:testimonialId", updateTestimonial);
router.delete("/delete/:testimonialId", deleteTestimonial);

export default router;
