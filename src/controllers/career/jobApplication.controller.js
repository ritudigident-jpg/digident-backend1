import Employee from "../../models/manage/employee.model.js";
import { sendSuccess } from "../../helpers/response.helper.js";
import { sendError, handleError } from "../../helpers/error.helper.js";
import { getPagination } from "../../helpers/pagination.helper.js";
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

    const paginationMeta = getPaginationMeta({
      totalItems: result.totalApplications,
      currentPage: pagination.page,
      limit: pagination.limit,
    });

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