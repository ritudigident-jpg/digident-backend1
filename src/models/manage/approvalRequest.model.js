import mongoose from "mongoose";
const { Schema, model } = mongoose;

const ApprovalRequestSchema = new Schema({
    requestId:{ type: String,unique: true },
    type: { type: String, required: true, trim: true },
    requestedBy: { type: String, required: true, trim: true, lowercase: true },
   targetId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
    payload: { type: Schema.Types.Mixed },

    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    approvedBy: { type: String, trim: true, lowercase: true,required:true },
    approvedAt: { type: Date, default: null },
    requestedAt: { type: Date, default: Date.now },
    comments: { type: String, trim: true, default: "" },
  },
  {
    timestamps: true,
  }
);
export default model("ApprovalRequest", ApprovalRequestSchema);

