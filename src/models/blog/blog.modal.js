import mongoose from "mongoose";
import { v6 as uuidv6 } from "uuid";

const { Schema, model } = mongoose;

const blogSchema = new Schema(
  {
    blogId: {
      type: String,
      unique: true,
      required: true,
      default: () => uuidv6(),
      trim: true,
    },

    content: {
      type: String,
      required: true,
      default: "",
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

blogSchema.index({ blogId: 1 });

const Blog = model("Blog", blogSchema);

export default Blog;