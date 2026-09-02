import mongoose from "mongoose";

/* =========================================================
   TESTIMONIAL SCHEMA
   Mirrors the Digident feedback Google Form:
   Timestamp | Feedback | Suggestions for improvement | Name |
   Email | Contact Number | Organization Name | Purchased Product
========================================================= */
const testimonialSchema = new mongoose.Schema(
  {
    testimonialId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    feedback: {
      type: String,
      required: true,
      trim: true,
    },

    suggestions: {
      type: String,
      trim: true,
      default: "",
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },

    contactNumber: {
      type: String,
      trim: true,
      default: "",
    },

    organizationName: {
      type: String,
      trim: true,
      default: "",
    },

    purchasedProduct: {
      type: String,
      trim: true,
      default: "",
    },

    /* Original form submission time (falls back to createdAt) */
    submittedAt: {
      type: Date,
      default: Date.now,
    },

    /* Controls whether it is shown publicly on the website */
    isActive: {
      type: Boolean,
      default: false,
    },

    /* Manual ordering for the public testimonial carousel */
    displayOrder: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

const Testimonial = mongoose.model("Testimonial", testimonialSchema);

export default Testimonial;
