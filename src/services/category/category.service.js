/**
 * Business logic for product categories. Throws AppError subclasses on failure.
 *
 * Exports: createCategoryService, updateCategoryService, deleteCategoryService,
 * getAllCategoriesService
 * Used by: controllers/category/category.controller.js
 */

import { v6 as uuidv6 } from "uuid";
import Category from "../../models/category.model.js";
import { uploadToS3, deleteFromS3 } from "../aws/aws.service.js";
import { PermissionAudit } from "../../models/permissionaudit.model.js";
import { sendNotification } from "../notification/notification.service.js";
import { redis as redisClient } from "../../config/redis.config.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../helpers/apperror.helper.js";
import { logger } from "../../helpers/logger.helper.js";

/* =========================================================
   CACHE CONFIG
========================================================= */

const CACHE_TTL = 60 * 60;

/* =========================================================
   CACHE HELPERS
========================================================= */

const getCache = async (key) => {
  try {
    const cachedData = await redisClient.get(key);

    if (!cachedData) {
      return null;
    }

    return JSON.parse(cachedData);
  } catch (error) {
    logger.debug("REDIS GET CACHE ERROR", { error: error.message });

    return null;
  }
};

const setCache = async (key, data) => {
  try {
    await redisClient.set(key, JSON.stringify(data), {
      ex: CACHE_TTL,
    });
  } catch (error) {
    logger.debug("REDIS SET CACHE ERROR", { error: error.message });
  }
};

const clearCategoryCache = async () => {
  try {
    const keys = await redisClient.keys("CATEGORY:*");

    if (keys.length > 0) {
      await redisClient.del(...keys);

      logger.debug("CATEGORY CACHE CLEARED", { keys });
    }
  } catch (error) {
    logger.debug("REDIS CATEGORY CACHE CLEAR ERROR", { error: error.message });
  }
};

/**
 * Create category.
 *
 * @param {object} params
 * @param {*} params.name
 * @param {*} params.file
 * @param {*} params.employee
 * @param {*} params.permission
 * @returns {Promise<*>}
 * @throws {BadRequestError} 400 when the input breaks a rule.
 * @throws {ConflictError} 409 when the record already exists or was already processed.
 */
export const createCategoryService = async ({ name, file, employee, permission }) => {
  if (!name || !file) {
    throw new BadRequestError("Category name and image are required");
  }

  const exist = await Category.findOne({ name });
  if (exist) {
    throw new ConflictError("Category already exists");
  }

  /* ---------- UPLOAD IMAGE ---------- */
  const uploadedImage = await uploadToS3(file, "category");

  /* ---------- CREATE CATEGORY ---------- */
  const category = await Category.create({
    categoryId: uuidv6(),
    name,
    image: uploadedImage.url,
  });
  /* ---------- CLEAR CACHE ---------- */
  await clearCategoryCache();

  /* ---------- AUDIT ---------- */
  try {
    await PermissionAudit.create({
      permissionAuditId: uuidv6(),
      actionBy: employee._id,
      actionByEmail: employee.email,
      actionFor: category._id,
      action: category.name,
      permission: permission,
      actionType: "Create",
    });
  } catch (err) {
    logger.error("Audit log failed on create category", { error: err.message });
  }

  /* ---------- NOTIFICATION ---------- */
  try {
    await sendNotification({
      sender: employee._id,
      permission: "product.category.create",
      title: "New Category Created",
      message: `${category.name} category has been created successfully`,
      type: "CATEGORY_CREATED",
      entityId: category._id,
      entityModel: "Category",
      metadata: {
        categoryId: category.categoryId,
        categoryName: category.name,
        image: category.image,
        createdBy: employee.email,
      },
    });
  } catch (err) {
    logger.error("Notification failed on create category", { error: err.message });
  }
  return category;
};

/**
 * Update category.
 *
 * @param {object} params
 * @param {*} params.categoryId
 * @param {*} params.name
 * @param {*} params.file
 * @param {*} params.employee
 * @param {*} params.permission
 * @returns {Promise<*>}
 * @throws {BadRequestError} 400 when the input breaks a rule.
 * @throws {NotFoundError} 404 when a record does not exist.
 * @throws {ConflictError} 409 when the record already exists or was already processed.
 */
export const updateCategoryService = async ({ categoryId, name, file, employee, permission }) => {
  let newImageUpload;
  try {
    if (!categoryId) {
      throw new BadRequestError("CategoryId is required");
    }

    /* ---------- FIND CATEGORY ---------- */
    const category = await Category.findOne({ categoryId });

    if (!category) {
      throw new NotFoundError("Category not found");
    }

    /* ---------- DUPLICATE CHECK ---------- */
    if (name) {
      const duplicate = await Category.findOne({ name });

      if (duplicate && duplicate.categoryId !== categoryId) {
        throw new ConflictError("Category name already exists");
      }
    }

    /* ---------- UPDATE IMAGE ---------- */
    if (file) {
      if (category.image) {
        await deleteFromS3(category.image);
      }

      newImageUpload = await uploadToS3(file, "category");
      category.image = newImageUpload.url;
    }

    /* ---------- UPDATE NAME ---------- */
    category.name = name ?? category.name;

    await category.save();
    /* ---------- CLEAR CACHE ---------- */
    await clearCategoryCache();
    /* ---------- AUDIT ---------- */
    try {
      await PermissionAudit.create({
        permissionAuditId: uuidv6(),
        actionBy: employee._id,
        actionByEmail: employee.email,
        actionFor: category._id,
        action: category.name,
        permission: permission || "update_category",
        actionType: "Update",
      });
    } catch (err) {
      logger.error("Audit log failed on update category", { error: err.message });
    }
    /* ---------- NOTIFICATION ---------- */
    try {
      await sendNotification({
        sender: employee._id,
        permission: "product.category.update",
        title: "Category Updated",
        message: `${category.name} category updated successfully`,
        type: "CATEGORY_UPDATED",
        entityId: category._id,
        entityModel: "Category",
        metadata: {
          categoryId: category.categoryId,
          categoryName: category.name,
          image: category.image,
          updatedBy: employee.email,
        },
      });
    } catch (err) {
      logger.error("Notification failed on update category", { error: err.message });
    }
    return category;
  } catch (error) {
    /* ---------- ROLLBACK ---------- */
    if (newImageUpload?.url) {
      await deleteFromS3(newImageUpload.url);
    }

    throw error;
  }
};

/**
 * Delete category.
 *
 * @param {object} params
 * @param {*} params.categoryId
 * @param {*} params.employee
 * @param {*} params.permission
 * @returns {Promise<*>}
 * @throws {BadRequestError} 400 when the input breaks a rule.
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const deleteCategoryService = async ({ categoryId, employee, permission }) => {
  if (!categoryId) {
    throw new BadRequestError("CategoryId is required");
  }

  /* ---------- FIND CATEGORY ---------- */
  const category = await Category.findOne({ categoryId });

  if (!category) {
    throw new NotFoundError("Category not found");
  }

  /* ---------- DELETE IMAGE FROM S3 ---------- */
  if (category.image) {
    await deleteFromS3(category.image);
  }

  /* ---------- DELETE CATEGORY ---------- */
  await Category.deleteOne({ categoryId });
  /* ---------- CLEAR CACHE ---------- */
  await clearCategoryCache();
  /* ---------- AUDIT ---------- */
  try {
    await PermissionAudit.create({
      permissionAuditId: uuidv6(),
      actionBy: employee._id,
      actionByEmail: employee.email,
      actionFor: category._id,
      action: category.name,
      permission: permission || "delete_category",
      actionType: "Delete",
    });
  } catch (err) {
    logger.error("Audit log failed on delete category", { error: err.message });
  }
  /* ---------- NOTIFICATION ---------- */
  try {
    await sendNotification({
      sender: employee._id,
      permission: "product.category.delete",
      title: "Category Deleted",
      message: `${category.name} category deleted successfully`,
      type: "CATEGORY_DELETED",
      entityId: category._id,
      entityModel: "Category",
      metadata: {
        categoryId: category.categoryId,
        categoryName: category.name,
        deletedBy: employee.email,
      },
    });
  } catch (err) {
    logger.error("Notification failed on delete category", { error: err.message });
  }
  return true;
};

/**
 * Get all categories.
 * @returns {Promise<*>}
 */
export const getAllCategoriesService = async () => {
  /* ---------- CACHE KEY ---------- */
  const cacheKey = `CATEGORY:ALL`;
  /* ---------- CACHE CHECK ---------- */
  const cachedData = await getCache(cacheKey);
  if (cachedData) {
    logger.debug("CATEGORY CACHE HIT", { cacheKey });
    return cachedData;
  }
  const [categories, totalCategories] = await Promise.all([
    Category.find().sort({ name: 1 }).lean(),
    Category.countDocuments(),
  ]);
  const result = {
    categories,
    totalCategories,
  };
  /* ---------- STORE CACHE ---------- */
  await setCache(cacheKey, result);
  return result;
};
