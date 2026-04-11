import Employee from "../../models/manage/employee.model.js";
import { sendSuccess } from "../../helpers/response.helper.js";
import { sendError, handleError } from "../../helpers/error.helper.js";
import { getPagination} from "../../helpers/pagination.helper.js";
import {
  createJobValidator,
  updateJobValidator,
} from "./job.validator.js";
import {
  createJobService,
  updateJobService,
  getJobsService,
  getPublishedJobsService,
  getJobByIdService,
  getJobBySlugService,
  deleteJobService,
} from "../../services/job.service.js";

export const createJob = async (req, res) => {
  try {
    const { value, error } = createJobValidator.validate(req.body, {
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

    const job = await createJobService({
      data: value,
      employee,
    });

    return sendSuccess(res, job, 201, "Job created successfully");
  } catch (error) {
    return handleError(res, error);
  }
};

export const updateJob = async (req, res) => {
  try {
    const { value, error } = updateJobValidator.validate(req.body, {
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

    const job = await updateJobService({
      jobId: req.params.jobId,
      data: value,
      employee,
    });

    return sendSuccess(res, job, 200, "Job updated successfully");
  } catch (error) {
    return handleError(res, error);
  }
};

export const getManageJobs = async (req, res) => {
  try {
    const pagination = getPagination(req.query);

    const {
      search,
      status = "all",
      department,
      employmentType,
      workplaceType,
      experienceLevel,
    } = req.query;

    const result = await getJobsService({
      pagination,
      filters: {
        search,
        status,
        department,
        employmentType,
        workplaceType,
        experienceLevel,
      },
    });

    const paginationMeta = getPaginationMeta({
      totalItems: result.totalJobs,
      currentPage: pagination.page,
      limit: pagination.limit,
    });

    return sendSuccess(
      res,
      {
        pagination: paginationMeta,
        jobs: result.jobs,
      },
      200,
      "Jobs fetched successfully"
    );
  } catch (error) {
    return handleError(res, error);
  }
};

export const getCareerJobs = async (req, res) => {
  try {
    const pagination = getPagination(req.query);

    const { search, department, employmentType, workplaceType, experienceLevel } = req.query;

    const result = await getPublishedJobsService({
      pagination,
      filters: {
        search,
        department,
        employmentType,
        workplaceType,
        experienceLevel,
      },
    });

    /* ---------- PAGINATION META ---------- */
    const totalItems = result.totalJobs;
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
        jobs: result.jobs,
      },
      200,
      "Career jobs fetched successfully"
    );
  } catch (error) {
    return handleError(res, error);
  }
};

export const getJobById = async (req, res) => {
  try {
    const job = await getJobByIdService({
      jobId: req.params.jobId,
    });

    return sendSuccess(res, job, 200, "Job fetched successfully");
  } catch (error) {
    return handleError(res, error);
  }
};

export const getJobBySlug = async (req, res) => {
  try {
    const job = await getJobBySlugService({
      slug: req.params.slug,
    });

    return sendSuccess(res, job, 200, "Job fetched successfully");
  } catch (error) {
    return handleError(res, error);
  }
};

export const deleteJob = async (req, res) => {
  try {
    await deleteJobService({
      jobId: req.params.jobId,
    });

    return sendSuccess(res, null, 200, "Job deleted successfully");
  } catch (error) {
    return handleError(res, error);
  }
};