/**
 * Mongoose model "Category": product categories.
 *
 * Used by: services/banner/banner.service.js, services/category/category.service.js
 */

import mongoose from "mongoose";
const { Schema } = mongoose;
const categorySchema = new Schema(
  {
    categoryId: {
      type: String,
      unique: true,
    },
    name: {
      type: String,
      required: [true, "Category name is required"],
      unique: true,
      trim: true,
      minlength: 2,
      maxlength: 50,
    },
    image: {
      type: String,
      required: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model("Category", categorySchema);
