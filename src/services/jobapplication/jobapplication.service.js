/**
 * Business logic for job applications with resume upload. Throws AppError subclasses on failure.
 *
 * Exports: submitJobApplicationService, updateJobApplicationService, getApplicationsService,
 * getApplicationByIdService, updateApplicationStatusService, addApplicationNoteService,
 * assignApplicationService
 * Used by: controllers/jobapplication/jobapplication.controller.js
 */

import Job from "../../models/job.model.js";
import JobApplication from "../../models/jobapplication.model.js";
import { v6 as uuidv6 } from "uuid";
import { sendNotification } from "../notification/notification.service.js";
import { clearJobCache } from "../job/job.service.js";
import { ConflictError, NotFoundError } from "../../helpers/apperror.helper.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import { logger } from "../../helpers/logger.helper.js";

/**
 * Submit job application.
 *
 * @param {object} params
 * @param {*} params.data
 * @param {*} params.resumeFile
 * @param {*} [params.additionalFiles]
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 * @throws {ConflictError} 409 when the record already exists or was already processed.
 */
export const submitJobApplicationService = async ({ data, resumeFile, additionalFiles = [] }) => {
  const job = await Job.findOne({
    jobId: data.jobId,
    status: "published",
  });
  if (!job) {
    throw new NotFoundError("Job not found or not open for application");
  }
  const existingApplication = await JobApplication.findOne({
    jobId: data.jobId,
    "applicant.email": data.email.toLowerCase(),
    isDeleted: false,
  });

  if (existingApplication) {
    throw new ConflictError("You have already applied for this job");
  }

  const application = await JobApplication.create({
    job: job._id,
    jobId: job.jobId,
    applicationId: uuidv6(),
    applicant: {
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email.toLowerCase(),
      phone: data.phone,
      city: data.city || null,
      state: data.state || null,
      country: data.country || null,
      totalExperienceYears: data.totalExperienceYears || 0,
      currentCompany: data.currentCompany || null,
      currentCTC: data.currentCTC || 0,
      expectedCTC: data.expectedCTC || 0,
      noticePeriodDays: data.noticePeriodDays || 0,
      portfolioUrl: data.portfolioUrl || null,
      linkedinUrl: data.linkedinUrl || null,
      githubUrl: data.githubUrl || null,
    },
    coverLetter: data.coverLetter || null,
    resume: resumeFile,
    additionalFiles,
    source: data.source || "career_page",
  });
  /* ---------- CLEAR JOB CACHE ---------- */
  await clearJobCache();
  /* ---------- NOTIFICATION ---------- */
  try {
    await sendNotification({
      sender: null,
      permission: "hr.career.read",
      title: "New Job Application Received",
      message: `${data.firstName} ${data.lastName} applied for "${job.title}"`,
      type: "APPLICATION_SUBMITTED",
      entityId: application._id,
      entityModel: "JobApplication",
      metadata: {
        applicationId: application.applicationId,
        jobId: job.jobId,
        jobTitle: job.title,
        applicantName: `${data.firstName} ${data.lastName}`,
        applicantEmail: data.email.toLowerCase(),
        source: application.source,
      },
    });
  } catch (err) {
    logger.error("Notification failed on submit application", { error: err.message });
  }

  return application;
};

/**
 * @function updateJobApplicationService
 *
 * @description
 * Update existing job application data in database.
 *
 * @process
 * 1. Find published job by jobId
 * 2. Find existing application by applicationId
 * 3. Check duplicate application for same job + email except current one
 * 4. Update application fields
 * 5. Save application
 *
 * @returns {Promise<Object>} Updated application document
 */
export const updateJobApplicationService = async ({
  applicationId,
  data,
  resumeFile,
  additionalFiles = [],
}) => {
  /* ---------- FIND JOB ---------- */
  const job = await Job.findOne({
    jobId: data.jobId,
    status: "published",
  });

  if (!job) {
    throw new NotFoundError("Job not found or not open for application");
  }

  /* ---------- FIND APPLICATION ---------- */
  const application = await JobApplication.findOne({
    applicationId,
    isDeleted: false,
  });

  if (!application) {
    throw new NotFoundError("Application not found", { code: ERROR_CODES.APPLICATION_NOT_FOUND });
  }

  /* ---------- DUPLICATE CHECK ---------- */
  const duplicateApplication = await JobApplication.findOne({
    _id: { $ne: application._id },
    jobId: data.jobId,
    "applicant.email": data.email.toLowerCase(),
    isDeleted: false,
  });

  if (duplicateApplication) {
    throw new ConflictError("You have already applied for this job");
  }

  /* ---------- UPDATE DATA ---------- */
  application.job = job._id;
  application.jobId = job.jobId;

  application.applicant.firstName = data.firstName;
  application.applicant.lastName = data.lastName;
  application.applicant.email = data.email.toLowerCase();
  application.applicant.phone = data.phone;
  application.applicant.city = data.city || null;
  application.applicant.state = data.state || null;
  application.applicant.country = data.country || null;
  application.applicant.totalExperienceYears = data.totalExperienceYears || 0;
  application.applicant.currentCompany = data.currentCompany || null;
  application.applicant.currentCTC = data.currentCTC || 0;
  application.applicant.expectedCTC = data.expectedCTC || 0;
  application.applicant.noticePeriodDays = data.noticePeriodDays || 0;
  application.applicant.portfolioUrl = data.portfolioUrl || null;
  application.applicant.linkedinUrl = data.linkedinUrl || null;
  application.applicant.githubUrl = data.githubUrl || null;

  application.coverLetter = data.coverLetter || null;
  application.resume = resumeFile;
  application.additionalFiles = additionalFiles;
  application.source = data.source || "career_page";

  await application.save();
  /* ---------- CLEAR JOB CACHE ---------- */
  await clearJobCache();

  return application;
};

/**
 * Get applications.
 *
 * @param {object} params
 * @param {*} params.pagination
 * @param {*} params.filters
 * @returns {Promise<*>}
 */
export const getApplicationsService = async ({ pagination, filters }) => {
  const { skip, limit, page } = pagination;
  const { jobId, status, search, source } = filters;

  const query = {
    isDeleted: false,
  };

  if (jobId) {
    query.jobId = jobId;
  }

  if (status && status !== "all") {
    query.status = status;
  }

  if (source) {
    query.source = source;
  }

  if (search) {
    query.$or = [
      { "applicant.firstName": { $regex: search, $options: "i" } },
      { "applicant.lastName": { $regex: search, $options: "i" } },
      { "applicant.email": { $regex: search, $options: "i" } },
      { "applicant.phone": { $regex: search, $options: "i" } },
    ];
  }

  const [applications, totalItems] = await Promise.all([
    JobApplication.find(query)
      .populate("job", "jobId title department location employmentType workplaceType status")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    JobApplication.countDocuments(query),
  ]);

  const totalPages = Math.ceil(totalItems / limit);

  return {
    applications,
    pagination: {
      totalItems,
      totalPages,
      currentPage: page,
      nextPage: page < totalPages ? page + 1 : null,
      prevPage: page > 1 ? page - 1 : null,
      limit,
    },
  };
};

/**
 * Get application by id.
 *
 * @param {object} params
 * @param {*} params.applicationId
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const getApplicationByIdService = async ({ applicationId }) => {
  const application = await JobApplication.findOne({
    applicationId,
    isDeleted: false,
  })
    .populate("job", "jobId title department location employmentType workplaceType status")
    .lean();

  if (!application) {
    throw new NotFoundError("Application not found", { code: ERROR_CODES.APPLICATION_NOT_FOUND });
  }

  return application;
};

/**
 * Update application status.
 *
 * @param {object} params
 * @param {*} params.applicationId
 * @param {*} params.status
 * @param {*} params.note
 * @param {*} params.employee
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const updateApplicationStatusService = async ({ applicationId, status, note, employee }) => {
  const application = await JobApplication.findOne({
    applicationId,
    isDeleted: false,
  });

  if (!application) {
    throw new NotFoundError("Application not found", { code: ERROR_CODES.APPLICATION_NOT_FOUND });
  }

  application.status = status;
  application.reviewedAt = new Date();

  if (note) {
    application.notes.push({
      note,
      addedBy: {
        employeeId: employee?.employeeId || null,
        employeeRef: employee?._id || null,
        name: employee?.name || null,
        email: employee?.email || null,
      },
    });
  }

  await application.save();
  /* ---------- CLEAR JOB CACHE ---------- */
  await clearJobCache();

  return application;
};

/**
 * Add application note.
 *
 * @param {object} params
 * @param {*} params.applicationId
 * @param {*} params.note
 * @param {*} params.employee
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const addApplicationNoteService = async ({ applicationId, note, employee }) => {
  const application = await JobApplication.findOne({
    applicationId,
    isDeleted: false,
  });

  if (!application) {
    throw new NotFoundError("Application not found", { code: ERROR_CODES.APPLICATION_NOT_FOUND });
  }

  application.notes.push({
    note,
    addedBy: {
      employeeId: employee?.employeeId || null,
      employeeRef: employee?._id || null,
      name: employee?.name || null,
      email: employee?.email || null,
    },
  });

  await application.save();

  return application;
};

/**
 * Assign application.
 *
 * @param {object} params
 * @param {*} params.applicationId
 * @param {*} params.employeeToAssign
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const assignApplicationService = async ({ applicationId, employeeToAssign }) => {
  const application = await JobApplication.findOne({
    applicationId,
    isDeleted: false,
  });

  if (!application) {
    throw new NotFoundError("Application not found", { code: ERROR_CODES.APPLICATION_NOT_FOUND });
  }

  application.assignedTo = {
    employeeId: employeeToAssign?.employeeId || null,
    employeeRef: employeeToAssign?._id || null,
    name: employeeToAssign?.name || null,
    email: employeeToAssign?.email || null,
  };

  await application.save();

  return application;
};
