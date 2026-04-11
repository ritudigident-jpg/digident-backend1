import express from "express";
import  authToken  from "../../middlewares/auth.middleware.js";
import { checkPermission } from "../../middlewares/permission.middleware.js";
// import { careerUpload } from "../../middlewares/upload.middleware.js";

import {
  createJob,
  updateJob,
  getManageJobs,
  getCareerJobs,
  getJobById,
  getJobBySlug,
  deleteJob,
} from "../../controllers/career/job.controller.js";

import {
  submitJobApplication,
  getManageApplications,
  getApplicationById,
  updateApplicationStatus,
  addApplicationNote,
  assignApplication,
} from "../../controllers/career/jobApplication.controller.js";

const router = express.Router();

/* ================= PUBLIC CAREER ROUTES ================= */
router.get("/jobs", getCareerJobs);
router.get("/jobs/:slug", getJobBySlug);

router.post(
  "/apply",
//   careerUpload.fields([
//     { name: "resume", maxCount: 1 },
//     { name: "additionalFiles", maxCount: 5 },
//   ]),
  submitJobApplication
);

/* ================= MANAGE JOB ROUTES ================= */
router.post(
  "/manage/jobs",
  authToken,
  checkPermission(),
  createJob
);

router.get(
  "/manage/jobs",
  authToken,
  checkPermission(),
  getManageJobs
);

router.get(
  "/manage/jobs/:jobId",
  authToken,
  getJobById
);

router.put(
  "/manage/jobs/:jobId",
  authToken,
  checkPermission(),
  updateJob
);

router.delete(
  "/manage/jobs/:jobId",
  authToken,
  checkPermission(),
  deleteJob
);

/* ================= MANAGE APPLICATION ROUTES ================= */
router.get(
  "/manage/applications",
  authToken,
  checkPermission("career.application.list"),
  getManageApplications
);

router.get(
  "/manage/applications/:applicationId",
  authToken,
  checkPermission("career.application.view"),
  getApplicationById
);

router.patch(
  "/manage/applications/:applicationId/status",
  authToken,
  checkPermission("career.application.update"),
  updateApplicationStatus
);

router.post(
  "/manage/applications/:applicationId/note",
  authToken,
  checkPermission("career.application.update"),
  addApplicationNote
);

router.patch(
  "/manage/applications/:applicationId/assign",
  authToken,
  checkPermission("career.application.assign"),
  assignApplication
);

export default router;