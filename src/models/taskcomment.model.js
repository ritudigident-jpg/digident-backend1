/**
 * Mongoose model "TaskComment": a comment on a task by an admin or an assignee. Kept in its own
 * collection (not inside the task) because a busy task can collect many comments.
 * Soft-deleted: a removed comment keeps its row with isDeleted = true.
 *
 * Used by: services/task/taskcomment.service.js
 */
import mongoose from "mongoose";
import { v6 as uuidv6 } from "uuid";

const { Schema } = mongoose;

const taskCommentSchema = new Schema(
  {
    commentId: { type: String, unique: true, default: () => uuidv6() },
    taskId: { type: String, required: true },
    author: {
      employeeId: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
      name: { type: String, trim: true, default: "" },
      email: { type: String, trim: true, lowercase: true, default: "" },
    },
    // True when written from the admin screens, so the UI can label it ("Admin").
    isFromAdmin: { type: Boolean, default: false },
    body: { type: String, required: true, trim: true },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "taskcomments" }
);

taskCommentSchema.index({ taskId: 1, isDeleted: 1, createdAt: 1 });

const TaskComment = mongoose.models.TaskComment || mongoose.model("TaskComment", taskCommentSchema);

export default TaskComment;
