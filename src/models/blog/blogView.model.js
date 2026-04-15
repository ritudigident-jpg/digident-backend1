import mongoose from "mongoose";
import { v6 as uuidv6 } from "uuid";

const { Schema, model } = mongoose;

const blogViewSchema = new Schema(
  {
    blogViewId: {
      type: String,
      unique: true,
      default: () => uuidv6(),
    },
    blog: {
      type: Schema.Types.ObjectId,
      ref: "Blog",
      required: true,
    },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    ipAddress: {
      type: String,
      trim: true,
      default: "",
    },
    userAgent: {
      type: String,
      trim: true,
      default: "",
    },
    referrer: {
      type: String,
      trim: true,
      default: "",
    },
    viewedAt: {
      type: Date,
      default: Date.now,
    },
    viewDate: {
      type: String,
      default: () => new Date().toISOString().slice(0, 10), // YYYY-MM-DD
    },
  },
  {
    timestamps: true,
  }
);

const BlogView = model("BlogView", blogViewSchema);
export default BlogView;