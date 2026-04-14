import express from "express";
import {
  createBlog,
  getBlogs,
  getBlogBySlug,
  addBlogComment,
  addBlogView,
} from "../../controllers/blog/blog.controller.js";
const router = express.Router();

/* ---------- BLOG ROUTES ---------- */
router.post("/", createBlog);
router.get("/", getBlogs);
router.get("/:slug", getBlogBySlug);
router.post("/:slug/comments", addBlogComment);
router.post("/:slug/view", addBlogView);

export default router;