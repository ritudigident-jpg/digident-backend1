/**
 * Mongoose model "Task": work an admin assigns to one or more employees. Holds title, description,
 * status, priority, tags, assignees, start / due date, estimate, a checklist (subtasks), the review
 * state and a capped activity log. Comments are in their own collection (taskcomment.model.js).
 *
 * Dates: startDate and dueDate are IST calendar dates stored as "YYYY-MM-DD" strings, the same
 * convention as attendance (helpers/istdate.helper.js). Strings in this format sort correctly, and
 * "overdue" is simply dueDate < today's IST date key.
 *
 * Assignees, createdBy and updatedBy are snapshots ({ employeeId, name, email }) resolved on the
 * server, so the list never needs a join and keeps the name if an employee is renamed or removed.
 *
 * Used by: services/task/*.js
 */
import mongoose from "mongoose";
import { v6 as uuidv6 } from "uuid";
import {
  TASK_STATUSES,
  TASK_STATUS,
  TASK_PRIORITIES,
  TASK_PRIORITY,
  TASK_ACTIVITY,
  PRIORITY_RANK,
  REVIEW_DECISIONS,
} from "../constants/task.constants.js";

const { Schema } = mongoose;

const personSchema = new Schema(
  {
    employeeId: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
    name: { type: String, trim: true, default: "" },
    email: { type: String, trim: true, lowercase: true, default: "" },
  },
  { _id: false }
);

const subtaskSchema = new Schema(
  {
    subtaskId: { type: String, default: () => uuidv6() },
    title: { type: String, required: true, trim: true },
    isDone: { type: Boolean, default: false },
    doneAt: { type: Date, default: null },
    doneBy: { type: personSchema, default: null },
  },
  { _id: false }
);

const activitySchema = new Schema(
  {
    action: { type: String, enum: Object.values(TASK_ACTIVITY), required: true },
    message: { type: String, default: "" },
    by: { type: personSchema, default: null },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

// Last submit / decision. Kept on the task so the board can show "changes requested: <note>".
const reviewSchema = new Schema(
  {
    submittedAt: { type: Date, default: null },
    submittedBy: { type: personSchema, default: null },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: personSchema, default: null },
    decision: { type: String, enum: [...REVIEW_DECISIONS, null], default: null },
    note: { type: String, default: "" },
  },
  { _id: false }
);

const taskSchema = new Schema(
  {
    // Human-readable, sequential: "TSK-1001". Used in every URL.
    taskId: { type: String, required: true, unique: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    status: { type: String, enum: TASK_STATUSES, default: TASK_STATUS.TODO },
    priority: { type: String, enum: TASK_PRIORITIES, default: TASK_PRIORITY.NORMAL },
    priorityRank: { type: Number, default: PRIORITY_RANK.normal },
    tags: { type: [String], default: [] },
    assignees: { type: [personSchema], default: [] },
    startDate: { type: String, default: null },
    dueDate: { type: String, default: null },
    estimateMinutes: { type: Number, default: null, min: 0 },
    // When false the assignee may mark the task done without an admin approving it.
    requiresReview: { type: Boolean, default: true },
    subtasks: { type: [subtaskSchema], default: [] },
    review: { type: reviewSchema, default: () => ({}) },
    commentCount: { type: Number, default: 0 },
    activity: { type: [activitySchema], default: [] },
    completedAt: { type: Date, default: null },
    createdBy: { type: personSchema, default: null },
    updatedBy: { type: personSchema, default: null },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: personSchema, default: null },
  },
  { timestamps: true, collection: "tasks" }
);

taskSchema.index({ isDeleted: 1, status: 1, dueDate: 1 });
taskSchema.index({ "assignees.employeeId": 1, isDeleted: 1, status: 1 });
taskSchema.index({ isDeleted: 1, createdAt: -1 });
taskSchema.index({ tags: 1 });

// Keep the sortable rank and the completion time in step with priority / status.
// No `next` parameter: Mongoose 9 removed it.
taskSchema.pre("save", function syncDerivedFields() {
  this.priorityRank = PRIORITY_RANK[this.priority] ?? PRIORITY_RANK.normal;
  if (this.isModified("status")) {
    this.completedAt = this.status === TASK_STATUS.DONE ? this.completedAt || new Date() : null;
  }
});

const Task = mongoose.models.Task || mongoose.model("Task", taskSchema);

/* Atomic running number for task ids: { _id: "task", seq: 1042 }. findOneAndUpdate + $inc is
   atomic, so two admins creating a task at the same moment never get the same id. */
export const TaskCounter =
  mongoose.models.TaskCounter ||
  mongoose.model(
    "TaskCounter",
    new Schema({ _id: { type: String }, seq: { type: Number, default: 0 } }, { versionKey: false }),
    "taskcounters"
  );

export default Task;
