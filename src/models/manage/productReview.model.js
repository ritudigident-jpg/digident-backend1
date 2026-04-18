import  mongoose from "mongoose";

const ratingEnum = ["Excellent", "Good", "Average", "Dissatisfied"];

// Generic rating schema (reusable)
const ratingSchema = new mongoose.Schema(
  {
    question: {
      type: String,
      required: true,
      trim: true,
    },
    score: {
      type: String,
      enum: ratingEnum,
      required: true,
    },
  },
  { _id: false }
);

// Product review schema
const productReviewSchema = new mongoose.Schema(
  {
    reviewId:{
      type: String,
      unique: true,
      required: true,
    },
    productType: {
      type: String,
      enum:[
        "Scan Body",
        "Horizontal Scan Body",
        "Lab Analog",
        "Screws",
        "Abutment",
      ],
      required: true,
    },

    reviewerInfo:{
      name: { type: String, required: true, trim: true },
      age: { type: Number },
      email: { type: String, required: true, lowercase: true },
      date: { type: Date, default: Date.now },
    },

    ratings: [ratingSchema],

    overallSatisfaction: {
      type: String,
      enum: ratingEnum,
      required: true,
    },

    comments: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true, // adds createdAt & updatedAt
  }
);
export default mongoose.model("ProductReview", productReviewSchema);