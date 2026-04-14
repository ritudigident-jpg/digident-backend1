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
      index: true,
    },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    ipAddress: {
      type: String,
      trim: true,
      default: "",
      index: true,
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
      index: true,
    },
    viewDate: {
      type: String,
      default: () => new Date().toISOString().slice(0, 10), // YYYY-MM-DD
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

blogViewSchema.index({ blog: 1, ipAddress: 1, viewDate: 1 });

const BlogView = model("BlogView", blogViewSchema);
export default BlogView;