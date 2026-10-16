/**
 * Business logic for implant brands (logo and downloadable files per category). Throws AppError
 * subclasses on failure.
 *
 * Exports: createBrandService, updateBrandService, getAllBrandsService, getBrandByIdService,
 * deleteBrandService, deleteAllBrandsService
 * Used by: controllers/brand/brand.controller.js
 */

import Brand from "../../models/brand.model.js";
import { v6 as uuidv6 } from "uuid";
import { uploadToS3, deleteFromS3 } from "../aws/aws.service.js";
import { PermissionAudit } from "../../models/permissionaudit.model.js";
import { sendNotification } from "../notification/notification.service.js";
import { redis as redisClient } from "../../config/redis.config.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../helpers/apperror.helper.js";
import { logger } from "../../helpers/logger.helper.js";

const ALLOWED_CATEGORIES = ["Abutment-Level", "General", "Screw-Retained"];
const CACHE_TTL = 60 * 60;

/* =========================================================
   CACHE HELPERS
========================================================= */
const clearBrandCache = async () => {
  try {
    const keys = await redisClient.keys("BRAND*");
    if (keys.length > 0) {
      await redisClient.del(...keys);
    }
  } catch (error) {
    logger.error("REDIS BRAND CACHE CLEAR ERROR", { error: error.message });
  }
};

const setCache = async (key, data) => {
  try {
    await redisClient.set(key, JSON.stringify(data), { ex: CACHE_TTL });
  } catch (error) {
    logger.error("REDIS SET CACHE ERROR", { error: error.message });
  }
};

const getCache = async (key) => {
  try {
    const cachedData = await redisClient.get(key);
    if (!cachedData) return null;
    return JSON.parse(cachedData);
  } catch (error) {
    logger.error("REDIS GET CACHE ERROR", { error: error.message });
    return null;
  }
};

/* =========================================================
   CREATE BRAND
========================================================= */
/**
 * Create brand.
 *
 * @param {object} params
 * @param {*} params.brandName
 * @param {*} params.categories
 * @param {*} params.files
 * @param {*} params.logoFile
 * @param {*} params.employee
 * @param {*} params.permission
 * @returns {Promise<*>}
 * @throws {BadRequestError} 400 when the input breaks a rule.
 * @throws {ConflictError} 409 when the record already exists or was already processed.
 */
export const createBrandService = async ({
  brandName,
  categories,
  files,
  logoFile,
  employee,
  permission,
}) => {
  let logoUpload;
  const fileUploads = [];
  try {
    if (!brandName) {
      throw new BadRequestError("Brand brandName is required", { code: ERROR_CODES.VALIDATION_ERROR });
    }
    if (!logoFile) {
      throw new BadRequestError("Logo is required", { code: ERROR_CODES.VALIDATION_ERROR });
    }
    const existingBrand = await Brand.findOne({ brandName });
    if (existingBrand) {
      throw new ConflictError("Brand already exists", { code: ERROR_CODES.BRAND_ALREADY_EXISTS });
    }
    /* ---------- UPLOAD LOGO ---------- */
    logoUpload = await uploadToS3(logoFile, "brands");

    const hasFiles = files && files.length > 0;
    if (!hasFiles && categories) {
      throw new BadRequestError("Category not allowed without files", { code: ERROR_CODES.VALIDATION_ERROR });
    }

    /* ---------- FILE PROCESS ---------- */
    if (hasFiles) {
      if (!categories) {
        throw new BadRequestError("Categories required when uploading files", {
          code: ERROR_CODES.VALIDATION_ERROR,
        });
      }
      const categoriesArray = Array.isArray(categories) ? categories : [categories];
      if (categoriesArray.length !== files.length) {
        throw new BadRequestError("Each file must have a corresponding category", {
          code: ERROR_CODES.VALIDATION_ERROR,
        });
      }
      for (const cat of categoriesArray) {
        if (!ALLOWED_CATEGORIES.includes(cat)) {
          throw new BadRequestError(`Invalid category: ${cat}`, { code: ERROR_CODES.INVALID_CATEGORY });
        }
      }
      for (let i = 0; i < files.length; i++) {
        const upload = await uploadToS3(files[i], "brands/file");
        fileUploads.push({
          fileId: uuidv6(),
          category: categoriesArray[i],
          fileLink: upload.url,
        });
      }
    }
    /* ---------- SAVE BRAND ---------- */
    const brand = await Brand.create({
      brandId: uuidv6(),
      brandName,
      logoUrl: logoUpload.url,
      files: fileUploads,
    });
    /* ---------- CLEAR CACHE ---------- */
    await clearBrandCache();
    /* ---------- AUDIT ---------- */
    try {
      await PermissionAudit.create({
        permissionAuditId: uuidv6(),
        actionBy: employee._id,
        actionByEmail: employee.email,
        actionFor: brand._id,
        action: brand.brandName,
        permission: permission || "create_brand",
        actionType: "Create",
      });
    } catch (err) {
      logger.error("Audit log failed on create brand", { error: err.message });
    }
    /* ---------- NOTIFICATION ---------- */
    try {
      await sendNotification({
        sender: employee._id,
        permission: "product.brand.create",
        title: "New Brand Created",
        message: `${brand.brandName} brand has been created successfully`,
        type: "BRAND_CREATED",
        entityId: brand._id,
        entityModel: "Brand",
        metadata: {
          brandId: brand.brandId,
          brandName: brand.brandName,
          totalFiles: brand.files.length,
          createdBy: employee.email,
        },
      });
    } catch (err) {
      logger.error("Notification failed on create brand", { error: err.message });
    }
    return brand;
  } catch (error) {
    /* ---------- ROLLBACK ---------- */
    if (logoUpload?.url) await deleteFromS3(logoUpload.url);
    for (const f of fileUploads) {
      await deleteFromS3(f.fileLink);
    }
    throw error;
  }
};

/* =========================================================
   UPDATE BRAND
========================================================= */
/**
 * Update brand.
 *
 * @param {object} params
 * @param {*} params.brandId
 * @param {*} params.brandName
 * @param {*} params.categories
 * @param {*} params.removeFileIds
 * @param {*} params.files
 * @param {*} params.logoFile
 * @param {*} params.employee
 * @param {*} params.permission
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 * @throws {ConflictError} 409 when the record already exists or was already processed.
 * @throws {BadRequestError} 400 when the input breaks a rule.
 */
export const updateBrandService = async ({
  brandId,
  brandName,
  categories,
  removeFileIds,
  files,
  logoFile,
  employee,
  permission,
}) => {
  let newLogoUpload;
  const newFileUploads = [];

  try {
    /* ---------- FIND BRAND ---------- */
    const brand = await Brand.findOne({ brandId });
    if (!brand) {
      throw new NotFoundError("Brand not found", { code: ERROR_CODES.BRAND_NOT_FOUND });
    }

    /* ---------- DUPLICATE brandName CHECK ---------- */
    if (brandName && brandName !== brand.brandName) {
      const exist = await Brand.findOne({ brandName });
      if (exist) {
        throw new ConflictError("Brand brandName already exists");
      }
      brand.brandName = brandName;
    }

    /* ---------- UPDATE LOGO ---------- */
    if (logoFile) {
      if (brand.logoUrl) await deleteFromS3(brand.logoUrl);
      newLogoUpload = await uploadToS3(logoFile, "brands");
      brand.logoUrl = newLogoUpload.url;
    }

    /* ---------- REMOVE FILES ---------- */
    if (removeFileIds) {
      const ids = Array.isArray(removeFileIds) ? removeFileIds : [removeFileIds];
      const remainingFiles = [];
      for (const file of brand.files || []) {
        if (ids.includes(file.fileId)) {
          await deleteFromS3(file.fileLink);
        } else {
          remainingFiles.push(file);
        }
      }
      brand.files = remainingFiles;
    }

    /* ---------- ADD NEW FILES ---------- */
    if (files && files.length > 0) {
      if (!categories) {
        throw new BadRequestError("Category is required when uploading files");
      }
      const categoriesArray = Array.isArray(categories) ? categories : [categories];
      if (categoriesArray.length !== files.length) {
        throw new BadRequestError("Each file must have a corresponding category");
      }
      for (const cat of categoriesArray) {
        if (!ALLOWED_CATEGORIES.includes(cat)) {
          throw new BadRequestError(`Invalid category: ${cat}`);
        }
      }
      for (let i = 0; i < files.length; i++) {
        const upload = await uploadToS3(files[i], "brands/file");
        newFileUploads.push({
          fileId: uuidv6(),
          category: categoriesArray[i],
          fileLink: upload.url,
        });
      }
      brand.files = brand.files || [];
      brand.files.push(...newFileUploads);
    }

    /* ---------- SAVE ---------- */
    await brand.save();

    /* ---------- CLEAR CACHE ---------- */
    await clearBrandCache();

    /* ---------- AUDIT ---------- */
    try {
      await PermissionAudit.create({
        permissionAuditId: uuidv6(),
        actionBy: employee._id,
        actionByEmail: employee.email,
        actionFor: brand._id,
        action: brand.brandName,
        permission: permission || "update_brand",
        actionType: "Update",
      });
    } catch (err) {
      logger.error("Audit log failed on update brand", { error: err.message });
    }
    /* ---------- NOTIFICATION ---------- */
    try {
      await sendNotification({
        sender: employee._id,
        permission: "product.brand.update",
        title: "Brand Updated",
        message: `${brand.brandName} brand updated successfully`,
        type: "BRAND_UPDATED",
        entityId: brand._id,
        entityModel: "Brand",
        metadata: {
          brandId: brand.brandId,
          brandName: brand.brandName,
          totalFiles: brand.files.length,
          updatedBy: employee.email,
        },
      });
    } catch (err) {
      logger.error("Notification failed on update brand", { error: err.message });
    }
    return brand;
  } catch (error) {
    /* ---------- ROLLBACK ---------- */
    if (newLogoUpload?.url) await deleteFromS3(newLogoUpload.url);
    for (const f of newFileUploads) {
      await deleteFromS3(f.fileLink);
    }
    throw error;
  }
};

/* =========================================================
   GET ALL BRANDS
========================================================= */
/**
 * Get all brands.
 * @returns {Promise<*>}
 */
export const getAllBrandsService = async () => {
  const cacheKey = `BRAND:ALL`;

  const cached = await getCache(cacheKey);
  if (cached) {
    logger.debug("CACHE HIT", { cacheKey });
    return cached;
  }

  const brands = await Brand.find().sort({ brandName: 1 }).lean();
  const totalBrands = await Brand.countDocuments();

  // FIX: cache the full result object not just brands array
  const result = { totalBrands, brands };
  await setCache(cacheKey, result);

  return result;
};

/* =========================================================
   GET BRAND BY ID
========================================================= */
/**
 * Get brand by id.
 *
 * @param {*} brandId
 * @returns {Promise<*>}
 * @throws {BadRequestError} 400 when the input breaks a rule.
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const getBrandByIdService = async (brandId) => {
  if (!brandId) {
    throw new BadRequestError("BrandId is required", { code: ERROR_CODES.VALIDATION_ERROR });
  }

  const brand = await Brand.findOne({ brandId }).lean();
  if (!brand) {
    throw new NotFoundError("Brand not found", { code: ERROR_CODES.BRAND_NOT_FOUND });
  }

  return brand;
};

/* =========================================================
   DELETE BRAND
========================================================= */
/**
 * Delete brand.
 *
 * @param {object} params
 * @param {*} params.brandId
 * @param {*} params.employee
 * @param {*} params.permission
 * @returns {Promise<*>}
 * @throws {BadRequestError} 400 when the input breaks a rule.
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const deleteBrandService = async ({ brandId, employee, permission }) => {
  if (!brandId) {
    throw new BadRequestError("BrandId is required");
  }

  /* ---------- FIND BRAND ---------- */
  const brand = await Brand.findOne({ brandId });
  if (!brand) {
    throw new NotFoundError("Brand not found", { code: ERROR_CODES.BRAND_NOT_FOUND });
  }

  /* ---------- DELETE LOGO ---------- */
  if (brand.logoUrl) {
    await deleteFromS3(brand.logoUrl);
  }

  /* ---------- DELETE FILES ---------- */
  if (brand.files?.length > 0) {
    for (const file of brand.files) {
      if (file.fileLink) {
        await deleteFromS3(file.fileLink);
      }
    }
  }

  /* ---------- DELETE BRAND ---------- */
  await Brand.deleteOne({ brandId });

  /* ---------- CLEAR CACHE ---------- */
  await clearBrandCache();

  /* ---------- AUDIT ---------- */
  try {
    await PermissionAudit.create({
      permissionAuditId: uuidv6(),
      actionBy: employee._id,
      actionByEmail: employee.email,
      actionFor: brand._id,
      action: brand.brandName,
      permission: permission || "delete_brand",
      actionType: "Delete",
    });
  } catch (err) {
    logger.error("Audit log failed on delete brand", { error: err.message });
  }

  /* ---------- NOTIFICATION ---------- */
  try {
    await sendNotification({
      sender: employee._id,
      permission: "product.brand.delete",
      title: "Brand Deleted",
      message: `${brand.brandName} brand deleted successfully`,
      type: "BRAND_DELETED",
      entityId: brand._id,
      entityModel: "Brand",
      // FIX: typo metadata → metadata
      metadata: {
        brandId: brand.brandId,
        brandName: brand.brandName,
        deletedBy: employee.email,
      },
    });
  } catch (err) {
    logger.error("Notification failed on delete brand", { error: err.message });
  }

  return true;
};

/* =========================================================
   DELETE ALL BRANDS  — not in use, kept for reference only
========================================================= */
/**
 * Delete all brands.
 *
 * @param {object} params
 * @param {*} params.employee
 * @param {*} params.permission
 * @returns {Promise<*>}
 * @throws {ForbiddenError} 403 when the caller may not do this.
 */
export const deleteAllBrandsService = async ({ employee, permission }) => {
  if (permission && permission !== "delete_brand") {
    throw new ForbiddenError("Unauthorized permission");
  }

  const brands = await Brand.find({});

  /* ---------- DELETE FROM S3 ---------- */
  for (const brand of brands) {
    if (brand.logoUrl) {
      await deleteFromS3(brand.logoUrl);
    }
    if (brand.files && brand.files.length > 0) {
      for (const file of brand.files) {
        if (file.fileLink) {
          await deleteFromS3(file.fileLink);
        }
      }
    }
  }

  /* ---------- DELETE ALL FROM DB ---------- */
  const result = await Brand.deleteMany({});

  /* ---------- CLEAR CACHE ---------- */
  await clearBrandCache();

  /* ---------- AUDIT ---------- */
  try {
    await PermissionAudit.create({
      permissionAuditId: uuidv6(),
      actionBy: employee._id,
      actionByEmail: employee.email,
      actionFor: null,
      action: "All Brands Deleted",
      permission: permission || "delete_brand",
      actionType: "Delete",
    });
  } catch (err) {
    logger.error("Audit log failed on delete all brands", { error: err.message });
  }

  return { deletedCount: result.deletedCount };
};
