import mongoose from "mongoose";
const { Schema } = mongoose;

const cartItemSchema = new Schema({
    productId: { type: String, required: true },
    variantId: { type: String, required: true },
    brandId: { type: Schema.Types.ObjectId, ref: "Brand", 
    required: true },
    categoryId: {
      type: Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
   sku: {
      type: String,
      trim: true,
      default: "",
      maxlength: 100,
    },
    productName: {
      type: String,
      trim: true,
      required: true,
      maxlength: 200,
    },
    variantName: {
      type: String,
      trim: true,
      default: "",
      maxlength: 200,
    },
    brandName: {
      type: String,
      trim: true,
      required: true,
      maxlength: 100,
    },
    categoryName: {
      type: String,
      trim: true,
      required: true,
      maxlength: 100,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    quantity: { type: Number, min: 1, default: 1 },
    attributes: {
      type: Map,
      of: Schema.Types.Mixed,
      default: {},
    },
    image: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { timestamps: true }
);

const cartSchema = new Schema({
    cartId: { type: String, unique: true },
    items: { type: [cartItemSchema], default: [] },
  },
  { timestamps: true }
);
export default mongoose.model("Cart", cartSchema);