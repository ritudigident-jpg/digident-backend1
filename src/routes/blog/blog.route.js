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
router.get("/get/:permission", auth, checkPermission(), getBlogs);

/* ---------- GET BLOG BY ID ---------- */
router.get("/get/:blogId/:permission", auth, checkPermission(), getBlogById);

router.delete("/delete/:blogId", auth, checkPermission(),deleteBlog);

export default router;