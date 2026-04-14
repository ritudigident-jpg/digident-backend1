import mongoose from "mongoose";
import slugify from "slugify";
import { v6 as uuidv6 } from "uuid";

const { Schema, model } = mongoose;

/* ---------- CONTENT BLOCK SCHEMA ---------- */
const contentBlockSchema = new Schema(
  {
    blockId: {
      type: String,
      default: () => uuidv6(),
    },
    type: {
      type: String,
      enum: ["heading", "paragraph", "image", "list", "quote"],
      required: true,
    },
    text: {
      type: String,
      trim: true,
      default: "",
    },
    level: {
      type: Number,
      default: 2,
    },
    listItems: [
      {
        type: String,
        trim: true,
      },
    ],
    image: {
      url: { type: String, trim: true, default: "" },
      key: { type: String, trim: true, default: "" },
      alt: { type: String, trim: true, default: "" },
    },
    order: {
      type: Number,
      default: 0,
    },
  },
  { _id: false }
);

/* ---------- COMMENT / REVIEW SCHEMA ---------- */
const blogCommentSchema = new Schema(
  {
    commentId: {
      type: String,
      default: () => uuidv6(),
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    company: {
      type: String,
      trim: true,
      maxlength: 150,
      default: "",
    },
    city: {
      type: String,
      trim: true,
      maxlength: 100,
      default: "",
    },
    review: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    isApproved: {
      type: Boolean,
      default: true, // change to false if you want admin approval
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

/* ---------- SEO SCHEMA ---------- */
const seoSchema = new Schema(
  {
    metaTitle: { type: String, trim: true, default: "" },
    metaDescription: { type: String, trim: true, default: "" },
    keywords: [{ type: String, trim: true }],
    canonicalUrl: { type: String, trim: true, default: "" },
    ogImage: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

/* ---------- BLOG SCHEMA ---------- */
const blogSchema = new Schema(
  {
    blogId: {
      type: String,
      unique: true,
      index: true,
      default: () => uuidv6(),
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    shortDescription: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    bannerImage: {
      url: { type: String, trim: true, default: "" },
      key: { type: String, trim: true, default: "" },
      alt: { type: String, trim: true, default: "" },
    },
    content: [contentBlockSchema],
    tags: [
      {
        type: String,
        trim: true,
        lowercase: true,
      },
    ],
    status: {
      type: String,
      enum: ["draft", "published", "archived"],
      default: "draft",
      index: true,
    },
    featured: {
      type: Boolean,
      default: false,
      index: true,
    },
    seo: {
      type: seoSchema,
      default: () => ({}),
    },
    comments: [blogCommentSchema],
    stats: {
      views: { type: Number, default: 0 },
      commentsCount: { type: Number, default: 0 },
    },
    readingTime: {
      type: Number,
      default: 1,
    },
    publishedAt: {
      type: Date,
      default: null,
      index: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

/* ---------- TEXT INDEX ---------- */
blogSchema.index({
  title: "text",
  shortDescription: "text",
  tags: "text",
});

/* ---------- PRE-VALIDATE SLUG ---------- */
blogSchema.pre("validate", function (next) {
  if (this.title && !this.slug) {
    this.slug = slugify(this.title, { lower: true, strict: true, trim: true });
  }
  next();
});

const Blog = model("Blog", blogSchema);
export default Blog;