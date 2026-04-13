import Employee from "../../models/manage/employee.model.js";
import { sendSuccess } from "../../helpers/response.helper.js";
import { sendError, handleError } from "../../helpers/error.helper.js";
import { getPagination } from "../../helpers/pagination.helper.js";
import JobApplication from "../../models/ecommarace/jobApplication.model.js";
import {
  submitJobApplicationValidator,
  updateApplicationStatusValidator,
  addApplicationNoteValidator,
} from "./jobApplication.validator.js";
import {
  submitJobApplicationService,
  getApplicationsService,
  getApplicationByIdService,
  updateApplicationStatusService,
  addApplicationNoteService,
  assignApplicationService,
  updateJobApplicationService
} from "../../services/jobApplication.service.js";
import { deleteFromS3, uploadToS3 } from "../../services/awsS3.service.js";


const uploadFiles = async (files = [], folder, additionalUploads = []) => {
  return Promise.all(
    files.map(async (file) => {
      if (!file) {
        throw new Error("Invalid file sent from frontend");
      }
      const uploaded = await uploadToS3(file, folder);
      if (!uploaded?.url){
        throw new Error("File upload failed");
      }
      if (uploaded?.key){
        additionalUploads.push(uploaded.key);
      }
      return uploaded.url;
    })
  );
}; 
export const submitJobApplication = async (req, res) => {
  const uploadedKeys = [];
  try {
    const { value, error } = submitJobApplicationValidator.validate(req.body, {
      abortEarly: false,
    });
    if (error) {
      return sendError(res, {
        message: "Validation failed",
        statusCode: 400,
        errorCode: "VALIDATION_ERROR",
        details: error.details.map((e) => e.message),
      });
    }
    if (!req.files?.resume || req.files.resume.length === 0) {
      return sendError(res, {
        message: "Resume/CV file is required",
        statusCode: 400,
        errorCode: "RESUME_REQUIRED",
      });
    }
    /* ---------- UPLOAD RESUME ---------- */
    const resumeUploaded = await uploadToS3(
      req.files.resume[0],
      "careers/resumes"
    );

    if (!resumeUploaded?.url) {
      throw new Error("Resume upload failed");
    }
    if (resumeUploaded?.key) {
      uploadedKeys.push(resumeUploaded.key);
    }
    /* ---------- UPLOAD ADDITIONAL FILES ---------- */
    const additionalUploads = req.files?.additionalFiles?.length
      ? await uploadFiles(
          req.files.additionalFiles,
          "careers/additional-files",
          uploadedKeys
        )
      : [];
    /* ---------- SAVE APPLICATION ---------- */
    const application = await submitJobApplicationService({
      data: value,
      resumeFile: resumeUploaded.url,
      additionalFiles: additionalUploads,
    });
    return sendSuccess(
      res,
      {
        applicationId: application.applicationId,
      },
      201,
      "Application submitted successfully"
    );
  } catch (error) {
    if (uploadedKeys.length) {
      await Promise.all(uploadedKeys.map((key) => deleteFromS3(key)));
    }
    return handleError(res, error);
  }
};

/**
 * @function updateJobApplication
 *
 * @description
 * Update an existing job application.
 *
 * @process
 * 1. Validate applicationId from params
 * 2. Fetch existing application
 * 3. Merge existing data with incoming req.body
 * 4. Validate merged payload using submitJobApplicationValidator
 * 5. Upload new resume if provided
 * 6. Upload additional files if provided
 * 7. Call service to update application
 * 8. Return success response
 *
 * @response
 * 200 { success: true, message: "Application updated successfully" }
 * 400 { success: false, message: "Validation failed" }
 * 404 { success: false, message: "Application not found" }
 */
export const updateJobApplication = async (req, res) => {
  const uploadedKeys = [];

  try {
    /* ---------- PARAMS ---------- */
    const { applicationId } = req.params;

    if (!applicationId) {
      return sendError(res, {
        message: "Application ID is required",
        statusCode: 400,
        errorCode: "APPLICATION_ID_REQUIRED",
      });
    }

    /* ---------- FETCH EXISTING APPLICATION ---------- */
    const existingApplication = await JobApplication.findOne({
      applicationId,
      isDeleted: false,
    });

    if (!existingApplication) {
      return sendError(res, {
        message: "Application not found",
        statusCode: 404,
        errorCode: "APPLICATION_NOT_FOUND",
      });
    }

    /* ---------- MERGE OLD DATA + NEW DATA ---------- */
    const mergedData = {
      jobId: req.body.jobId ?? existingApplication.jobId,
      firstName:
        req.body.firstName ?? existingApplication.applicant?.firstName,
      lastName:
        req.body.lastName ?? existingApplication.applicant?.lastName,
      email: req.body.email ?? existingApplication.applicant?.email,
      phone: req.body.phone ?? existingApplication.applicant?.phone,
      city: req.body.city ?? existingApplication.applicant?.city,
      state: req.body.state ?? existingApplication.applicant?.state,
      country: req.body.country ?? existingApplication.applicant?.country,
      totalExperienceYears:
        req.body.totalExperienceYears ??
        existingApplication.applicant?.totalExperienceYears,
      currentCompany:
        req.body.currentCompany ??
        existingApplication.applicant?.currentCompany,
      currentCTC:
        req.body.currentCTC ?? existingApplication.applicant?.currentCTC,
      expectedCTC:
        req.body.expectedCTC ?? existingApplication.applicant?.expectedCTC,
      noticePeriodDays:
        req.body.noticePeriodDays ??
        existingApplication.applicant?.noticePeriodDays,
      portfolioUrl:
        req.body.portfolioUrl ?? existingApplication.applicant?.portfolioUrl,
      linkedinUrl:
        req.body.linkedinUrl ?? existingApplication.applicant?.linkedinUrl,
      githubUrl:
        req.body.githubUrl ?? existingApplication.applicant?.githubUrl,
      coverLetter: req.body.coverLetter ?? existingApplication.coverLetter,
      source: req.body.source ?? existingApplication.source,
    };

    /* ---------- VALIDATION ---------- */
    const { value, error } = submitJobApplicationValidator.validate(mergedData, {
      abortEarly: false,
    });

    if (error) {
      return sendError(res, {
        message: "Validation failed",
        statusCode: 400,
        errorCode: "VALIDATION_ERROR",
        details: error.details.map((e) => e.message),
      });
    }

    /* ---------- UPLOAD RESUME IF PROVIDED ---------- */
    let resumeUrl = existingApplication.resume;
    if (req.files?.resume?.length) {
      const resumeUploaded = await uploadToS3(
        req.files.resume[0],
        "careers/resumes"
      );
      if (!resumeUploaded?.url) {
        throw new Error("Resume upload failed");
      }
      if (resumeUploaded?.key) {
        uploadedKeys.push(resumeUploaded.key);
      }
      resumeUrl = resumeUploaded.url;
    }

    /* ---------- UPLOAD ADDITIONAL FILES IF PROVIDED ---------- */
    let additionalFiles = existingApplication.additionalFiles || [];

    if (req.files?.additionalFiles?.length) {
      const additionalUploads = await uploadFiles(
        req.files.additionalFiles,
        "careers/additional-files",
        uploadedKeys
      );

      additionalFiles = [...additionalFiles, ...additionalUploads];
    }

    /* ---------- UPDATE APPLICATION ---------- */
    const application = await updateJobApplicationService({
      applicationId,
      data: value,
      resumeFile: resumeUrl,
      additionalFiles,
    });

    return sendSuccess(
      res,
      {
        applicationId: application.applicationId,
      },
      200,
      "Application updated successfully"
    );
  } catch (error) {
    if (uploadedKeys.length) {
      await Promise.all(uploadedKeys.map((key) => deleteFromS3(key)));
    }

    return handleError(res, error);
  }
};

export const getManageApplications = async (req, res) => {
  try {
    const pagination = getPagination(req.query);
    const {
      jobId,
      status = "all",
      search,
      source,
    } = req.query;
    const result = await getApplicationsService({
      pagination,
      filters: {
        jobId,
        status,
        search,
        source,
      },
    });
      /* ---------- PAGINATION META ---------- */
    const totalItems = result.totalApplications;
    const currentPage = pagination.page;
    const totalPages = Math.ceil(totalItems / pagination.limit);

    const paginationMeta = {
      totalItems,
      totalPages,
      currentPage,
      nextPage: currentPage < totalPages ? currentPage + 1 : null,
      prevPage: currentPage > 1 ? currentPage - 1 : null,
      limit: pagination.limit,
    };

    return sendSuccess(
      res,
      {
        pagination: paginationMeta,
        applications: result.applications,
      },
      200,
      "Applications fetched successfully"
    );
  } catch (error) {
    return handleError(res, error);
  }
};

export const getApplicationById = async (req, res) => {
  try {
    const application = await getApplicationByIdService({
      applicationId: req.params.applicationId,
    });

    return sendSuccess(
      res,
      application,
      200,
      "Application fetched successfully"
    );
  } catch (error) {
    return handleError(res, error);
  }
};

export const updateApplicationStatus = async (req, res) => {
  try {
    const { value, error } = updateApplicationStatusValidator.validate(req.body, {
      abortEarly: false,
    });

    if (error) {
      return sendError(res, {
        message: "Validation failed",
        statusCode: 400,
        errorCode: "VALIDATION_ERROR",
        details: error.details.map((e) => e.message),
      });
    }

    const employee = await Employee.findOne({ email: req.user.email });

    if (!employee) {
      return sendError(res, {
        message: "Employee not found",
        statusCode: 404,
        errorCode: "EMPLOYEE_NOT_FOUND",
      });
    }

    const application = await updateApplicationStatusService({
      applicationId: req.params.applicationId,
      status: value.status,
      note: value.note,
      employee,
    });

    return sendSuccess(
      res,
      application,
      200,
      "Application status updated successfully"
    );
  } catch (error) {
    return handleError(res, error);
  }
};

export const addApplicationNote = async (req, res) => {
  try {
    const { value, error } = addApplicationNoteValidator.validate(req.body, {
      abortEarly: false,
    });

    if (error) {
      return sendError(res, {
        message: "Validation failed",
        statusCode: 400,
        errorCode: "VALIDATION_ERROR",
        details: error.details.map((e) => e.message),
      });
    }

    const employee = await Employee.findOne({ email: req.user.email });

    if (!employee) {
      return sendError(res, {
        message: "Employee not found",
        statusCode: 404,
        errorCode: "EMPLOYEE_NOT_FOUND",
      });
    }

    const application = await addApplicationNoteService({
      applicationId: req.params.applicationId,
      note: value.note,
      employee,
    });

    return sendSuccess(res, application, 200, "Note added successfully");
  } catch (error) {
    return handleError(res, error);
  }
};

export const assignApplication = async (req, res) => {
  try {
    const { employeeId } = req.body;

    if (!employeeId) {
      return sendError(res, {
        message: "employeeId is required",
        statusCode: 400,
        errorCode: "VALIDATION_ERROR",
      });
    }

    const employeeToAssign = await Employee.findOne({ employeeId });

    if (!employeeToAssign) {
      return sendError(res, {
        message: "Employee to assign not found",
        statusCode: 404,
        errorCode: "EMPLOYEE_NOT_FOUND",
      });
    }

    const application = await assignApplicationService({
      applicationId: req.params.applicationId,
      employeeToAssign,
    });

    return sendSuccess(
      res,
      application,
      200,
      "Application assigned successfully"
    );
  } catch (error) {
    return handleError(res, error);
  }
};