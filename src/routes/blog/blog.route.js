import express from "express";
import upload from "../../middlewares/multer.middleware.js";
import auth from "../../middlewares/auth.middleware.js";
import { checkPermission } from "../../middlewares/permission.middleware.js";
import {
  createBlog,
  getBlogById,
  getBlogs,
  updateBlog,
  deleteBlog
} from "../../controllers/blog/blog.controller.js";
import { addBlogComment, deleteBlogComment, increaseBlogView } from "../../controllers/blog/blogView.controller.js";

const router = express.Router();

router.post(
  "/create",
  upload.fields([
    { name: "bannerImage", maxCount: 1 },
    { name: "contentImages", maxCount: 50 },
  ]),
  auth,
  checkPermission(),
  createBlog
);

router.put(
  "/update/:blogId",
  upload.fields([
    { name: "bannerImage", maxCount: 1 },
    { name: "contentImages", maxCount: 50 },
  ]),
  auth,
  checkPermission(),
  updateBlog
);

/* ---------- GET ALL BLOGS ---------- */
router.get("/manage/get/:permission", auth, checkPermission(), getBlogs);
router.get("/", getBlogs);
router.get("/:blogId", getBlogById);

/* ---------- GET BLOG BY ID ---------- */
router.get("/manage/get/:blogId/:permission", auth, checkPermission(), getBlogById);

router.delete("/manage/delete/:blogId", auth, checkPermission(),deleteBlog);

router.post("/comment/:blogId", addBlogComment);

router.post("/:blogId/view", increaseBlogView);

router.delete("/manage/delete/comment/:blogId/:commentId", auth, checkPermission(), deleteBlogComment);

export default router;