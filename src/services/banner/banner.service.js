/**
 * Business logic for homepage banners of the shop and website. Throws AppError subclasses on
 * failure.
 *
 * Exports: createBannerService, getAllBannersService, getBannersByIsActiveService,
 * updateBannerService, updateBannerDisplayOrderService, deleteBannerService,
 * getProductsByBannerService
 * Used by: controllers/banner/banner.controller.js
 */

import { v6 as uuidv6 } from "uuid";
import Banner from "../../models/banner.model.js";
import Category from "../../models/category.model.js";
import Brand from "../../models/brand.model.js";
import Product from "../../models/product.model.js";
import { PermissionAudit } from "../../models/permissionaudit.model.js";
import { uploadToS3, deleteFromS3 } from "../aws/aws.service.js";
import { sendNotification } from "../notification/notification.service.js";
import { redis as redisClient } from "../../config/redis.config.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../helpers/apperror.helper.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
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
    if (!cachedData) return null;
    return JSON.parse(cachedData);
  } catch (error) {
    logger.error("REDIS GET CACHE ERROR", { error: error.message });
    return null;
  }
};

const setCache = async (key, data) => {
  try {
    await redisClient.set(key, JSON.stringify(data), { ex: CACHE_TTL });
  } catch (error) {
    logger.error("REDIS SET CACHE ERROR", { error: error.message });
  }
};

const clearBannerCache = async () => {
  try {
    const keys = await redisClient.keys("BANNER:*");
    if (keys.length > 0) {
      await redisClient.del(...keys);
      logger.debug("BANNER CACHE CLEARED", { keys });
    }
  } catch (error) {
    logger.error("REDIS CACHE CLEAR ERROR", { error: error.message });
  }
};

/* =========================================================
   CREATE BANNER
========================================================= */
/**
 * Create banner.
 *
 * @param {object} params
 * @param {*} params.filterBy
 * @param {*} params.filterId
 * @param {*} [params.isActive]
 * @param {*} params.displayOrder
 * @param {*} params.file
 * @param {*} params.employee
 * @param {*} params.permission
 * @returns {Promise<*>}
 * @throws {BadRequestError} 400 when the input breaks a rule.
 * @throws {ConflictError} 409 when the record already exists or was already processed.
 */
export const createBannerService = async ({
  filterBy,
  filterId,
  isActive = true,
  displayOrder,
  file,
  employee,
  permission,
}) => {
  let imageUpload;
  try {
    if (!file) {
      throw new BadRequestError("Banner image is required");
    }

    if (!displayOrder || displayOrder < 1) {
      throw new BadRequestError("Valid displayOrder required");
    }

    /* ---------- DISPLAY ORDER CHECK ---------- */
    if (isActive) {
      const exists = await Banner.findOne({ displayOrder, isActive: true });
      if (exists) {
        throw new ConflictError(`Active banner already exists at displayOrder ${displayOrder}`);
      }
    }

    /* ---------- UPLOAD IMAGE ---------- */
    imageUpload = await uploadToS3(file, "banners");

    /* ---------- CREATE BANNER ---------- */
    const banner = await Banner.create({
      bannerId: uuidv6(),
      imageUrl: imageUpload.url,
      filterBy,
      filterId,
      isActive,
      displayOrder,
    });

    /* ---------- CLEAR CACHE ---------- */
    await clearBannerCache();

    /* ---------- AUDIT ---------- */
    try {
      await PermissionAudit.create({
        permissionAuditId: uuidv6(),
        actionBy: employee._id,
        actionByEmail: employee.email,
        actionFor: banner._id,
        action: `Banner Created | Banner:${banner.bannerId} | Filter:${banner.filterBy}:${banner.filterId} | Order:${banner.displayOrder}`,
        permission: permission || "create_banner",
        actionType: "Create",
      });
    } catch (err) {
      logger.error("Audit log failed on create banner", { error: err.message });
    }

    try {
      await sendNotification({
        sender: employee._id,
        permission: "marketing.banner.create",
        title: "New Banner Created",
        message: `Banner created successfully at display order ${displayOrder}`,
        type: "BANNER_CREATED",
        entityId: banner._id,
        entityModel: "Banner",
        metadata: {
          bannerId: banner.bannerId,
          filterBy,
          filterId,
          displayOrder,
          isActive,
          imageUrl: banner.imageUrl,
          createdBy: employee.email,
        },
      });
    } catch (err) {
      logger.error("Notification failed on create banner", { error: err.message });
    }

    return banner;
  } catch (error) {
    /* ---------- ROLLBACK ---------- */
    if (imageUpload?.url) {
      await deleteFromS3(imageUpload.url);
    }
    throw error;
  }
};

/* =========================================================
   GET ALL BANNERS
========================================================= */
/**
 * Get all banners.
 *
 * @param {object} params
 * @param {*} [params.page]
 * @param {*} [params.limit]
 * @returns {Promise<*>}
 * @throws {BadRequestError} 400 when the input breaks a rule.
 */
export const getAllBannersService = async ({ page = 1, limit = 10 }) => {
  page = Number(page);
  limit = Number(limit);

  if (page < 1 || limit < 1) {
    throw new BadRequestError("Invalid pagination values");
  }

  const skip = (page - 1) * limit;
  const cacheKey = `BANNER:ALL:${page}:${limit}`;

  /* ---------- CACHE CHECK ---------- */
  const cached = await getCache(cacheKey);
  if (cached) {
    logger.debug("CACHE HIT", { cacheKey });
    return cached;
  }

  /* ---------- FETCH ---------- */
  const [banners, totalItems] = await Promise.all([
    Banner.find({}).sort({ displayOrder: 1 }).skip(skip).limit(limit).lean(),
    Banner.countDocuments({}),
  ]);

  const totalPages = Math.ceil(totalItems / limit);

  const result = {
    pagination: {
      totalItems,
      totalPages,
      currentPage: page,
      nextPage: page < totalPages ? page + 1 : null,
      prevPage: page > 1 ? page - 1 : null,
      limit,
    },
    banners,
  };

  /* ---------- STORE CACHE ---------- */
  await setCache(cacheKey, result);

  return result;
};

/* =========================================================
   GET BANNERS BY ACTIVE STATUS
========================================================= */
/**
 * Get banners by is active.
 *
 * @param {object} params
 * @param {*} params.isActive
 * @param {*} [params.page]
 * @param {*} [params.limit]
 * @returns {Promise<*>}
 * @throws {BadRequestError} 400 when the input breaks a rule.
 */
export const getBannersByIsActiveService = async ({ isActive, page = 1, limit = 10 }) => {
  page = Number(page);
  limit = Number(limit);

  if (page < 1 || limit < 1) {
    throw new BadRequestError("Invalid pagination values");
  }

  if (typeof isActive !== "boolean") {
    throw new BadRequestError("isActive must be boolean");
  }

  const skip = (page - 1) * limit;
  const cacheKey = `BANNER:ACTIVE:${isActive}:${page}:${limit}`;

  /* ---------- CACHE ---------- */
  const cached = await getCache(cacheKey);
  if (cached) {
    logger.debug("CACHE HIT", { cacheKey });
    return cached;
  }

  const filter = { isActive };

  /* ---------- FETCH ---------- */
  const [banners, totalItems] = await Promise.all([
    Banner.find(filter).sort({ displayOrder: 1 }).skip(skip).limit(limit).lean(),
    Banner.countDocuments(filter),
  ]);

  const totalPages = Math.ceil(totalItems / limit);

  const result = {
    pagination: {
      totalItems,
      totalPages,
      currentPage: page,
      nextPage: page < totalPages ? page + 1 : null,
      prevPage: page > 1 ? page - 1 : null,
      limit,
    },
    banners,
  };

  /* ---------- STORE CACHE ---------- */
  await setCache(cacheKey, result);

  return result;
};

/* =========================================================
   UPDATE BANNER
========================================================= */
/**
 * Update banner.
 *
 * @param {object} params
 * @param {*} params.bannerId
 * @param {*} params.filterBy
 * @param {*} params.filterId
 * @param {*} params.isActive
 * @param {*} params.displayOrder
 * @param {*} params.file
 * @param {*} params.employee
 * @param {*} params.permission
 * @returns {Promise<*>}
 * @throws {BadRequestError} 400 when the input breaks a rule.
 * @throws {NotFoundError} 404 when a record does not exist.
 * @throws {ConflictError} 409 when the record already exists or was already processed.
 */
export const updateBannerService = async ({
  bannerId,
  filterBy,
  filterId,
  isActive,
  displayOrder,
  file,
  employee,
  permission,
}) => {
  let newImageUpload;
  try {
    if (!bannerId) {
      throw new BadRequestError("BannerId is required");
    }

    /* ---------- FIND BANNER ---------- */
    const banner = await Banner.findOne({ bannerId });
    if (!banner) {
      throw new NotFoundError("Banner not found");
    }

    /* ---------- DISPLAY ORDER CHECK ---------- */
    const shouldBeActive = isActive !== undefined ? isActive : banner.isActive;
    if (displayOrder !== undefined && shouldBeActive) {
      const conflict = await Banner.findOne({
        bannerId: { $ne: bannerId },
        displayOrder,
        isActive: true,
      });
      if (conflict) {
        throw new ConflictError(`displayOrder ${displayOrder} already used`);
      }
    }

    /* ---------- IMAGE UPDATE ---------- */
    if (file) {
      const oldImage = banner.imageUrl;
      newImageUpload = await uploadToS3(file, "banners");
      banner.imageUrl = newImageUpload.url;
      if (oldImage) {
        await deleteFromS3(oldImage);
      }
    }

    /* ---------- UPDATE FIELDS ---------- */
    if (filterBy !== undefined) banner.filterBy = filterBy;
    if (filterId !== undefined) banner.filterId = filterId;
    if (displayOrder !== undefined) banner.displayOrder = displayOrder;
    if (isActive !== undefined) banner.isActive = isActive;

    await banner.save();

    /* ---------- CLEAR CACHE ---------- */
    await clearBannerCache();

    /* ---------- AUDIT ---------- */
    try {
      await PermissionAudit.create({
        permissionAuditId: uuidv6(),
        actionBy: employee._id,
        actionByEmail: employee.email,
        actionFor: banner._id,
        action: `Banner Updated | Banner:${banner.bannerId} | Filter:${banner.filterBy}:${banner.filterId} | Order:${banner.displayOrder}`,
        permission: permission || "update_banner",
        actionType: "Update",
      });
    } catch (err) {
      logger.error("Audit log failed on update banner", { error: err.message });
    }

    /* ---------- NOTIFICATION ---------- */
    try {
      await sendNotification({
        sender: employee._id,
        permission: "marketing.banner.update",
        title: "Banner Updated",
        message: `Banner ${banner.bannerId} updated successfully`,
        type: "BANNER_UPDATED",
        entityId: banner._id,
        entityModel: "Banner",
        metadata: {
          bannerId: banner.bannerId,
          filterBy: banner.filterBy,
          filterId: banner.filterId,
          displayOrder: banner.displayOrder,
          isActive: banner.isActive,
          updatedBy: employee.email,
        },
      });
    } catch (err) {
      logger.error("Notification failed on update banner", { error: err.message });
    }

    return banner;
  } catch (error) {
    /* ---------- ROLLBACK ---------- */
    if (newImageUpload?.url) {
      await deleteFromS3(newImageUpload.url);
    }
    throw error;
  }
};

/* =========================================================
   UPDATE DISPLAY ORDER
========================================================= */
/**
 * Update banner display order.
 *
 * @param {object} params
 * @param {*} params.bannerId
 * @param {*} params.displayOrder
 * @param {*} params.employee
 * @param {*} params.permission
 * @returns {Promise<*>}
 * @throws {BadRequestError} 400 when the input breaks a rule.
 * @throws {NotFoundError} 404 when a record does not exist.
 * @throws {ConflictError} 409 when the record already exists or was already processed.
 */
export const updateBannerDisplayOrderService = async ({ bannerId, displayOrder, employee, permission }) => {
  if (!bannerId) {
    throw new BadRequestError("BannerId is required");
  }

  if (!displayOrder || displayOrder < 1) {
    throw new BadRequestError("displayOrder must be >= 1");
  }

  /* ---------- FIND ---------- */
  const banner = await Banner.findOne({ bannerId });
  if (!banner) {
    throw new NotFoundError("Banner not found");
  }

  /* ---------- CONFLICT ---------- */
  if (banner.isActive) {
    const conflict = await Banner.findOne({
      bannerId: { $ne: bannerId },
      displayOrder,
      isActive: true,
    });
    if (conflict) {
      throw new ConflictError(`displayOrder ${displayOrder} already exists`);
    }
  }

  /* ---------- UPDATE ---------- */
  banner.displayOrder = displayOrder;
  await banner.save();

  /* ---------- CLEAR CACHE ---------- */
  await clearBannerCache();

  /* ---------- AUDIT ---------- */
  try {
    await PermissionAudit.create({
      permissionAuditId: uuidv6(),
      actionBy: employee._id,
      actionByEmail: employee.email,
      actionFor: banner._id,
      action: `Banner Display Order Updated | Banner:${banner.bannerId} | Order:${banner.displayOrder}`,
      permission: permission || "update_banner",
      actionType: "Update",
    });
  } catch (err) {
    logger.error("Audit log failed on update display order", { error: err.message });
  }

  /* ---------- NOTIFICATION ---------- */
  try {
    await sendNotification({
      sender: employee._id,
      permission: "marketing.banner.update",
      title: "Banner Display Order Updated",
      message: `Banner order changed to ${banner.displayOrder}`,
      type: "BANNER_DISPLAY_ORDER_UPDATED",
      entityId: banner._id,
      entityModel: "Banner",
      metadata: {
        bannerId: banner.bannerId,
        displayOrder: banner.displayOrder,
        updatedBy: employee.email,
      },
    });
  } catch (err) {
    logger.error("Notification failed on update display order", { error: err.message });
  }

  return banner;
};

/* =========================================================
   DELETE BANNER
========================================================= */
/**
 * Delete banner.
 *
 * @param {object} params
 * @param {*} params.bannerId
 * @param {*} params.employee
 * @param {*} params.permission
 * @returns {Promise<*>}
 * @throws {BadRequestError} 400 when the input breaks a rule.
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const deleteBannerService = async ({ bannerId, employee, permission }) => {
  if (!bannerId) {
    throw new BadRequestError("BannerId is required");
  }

  /* ---------- FIND ---------- */
  const banner = await Banner.findOne({ bannerId });
  if (!banner) {
    throw new NotFoundError("Banner not found");
  }

  /* ---------- DELETE FROM DB FIRST ---------- */
  await Banner.findByIdAndDelete(banner._id);

  /* ---------- DELETE IMAGE ---------- */
  if (banner.imageUrl) {
    try {
      await deleteFromS3(banner.imageUrl);
    } catch (err) {
      logger.error("S3 image delete failed", { error: err.message });
    }
  }

  /* ---------- CLEAR CACHE ---------- */
  await clearBannerCache();

  /* ---------- AUDIT ---------- */
  try {
    await PermissionAudit.create({
      permissionAuditId: uuidv6(),
      actionBy: employee._id,
      actionByEmail: employee.email,
      actionFor: banner._id,
      action: `Banner Deleted | Banner:${banner.bannerId} | Filter:${banner.filterBy}:${banner.filterId}`,
      permission: permission || "delete_banner",
      actionType: "Delete",
    });
  } catch (err) {
    logger.error("Audit log failed on delete banner", { error: err.message });
  }

  /* ---------- NOTIFICATION ---------- */
  try {
    await sendNotification({
      sender: employee._id,
      permission: "marketing.banner.delete",
      title: "Banner Deleted",
      message: `Banner ${banner.bannerId} deleted successfully`,
      type: "BANNER_DELETED",
      entityId: banner._id,
      entityModel: "Banner",
      metadata: {
        bannerId: banner.bannerId,
        filterBy: banner.filterBy,
        filterId: banner.filterId,
        deletedBy: employee.email,
      },
    });
  } catch (err) {
    logger.error("Notification failed on delete banner", { error: err.message });
  }

  return true;
};

/* =========================================================
   GET PRODUCTS BY BANNER
========================================================= */
/**
 * Get products by banner.
 *
 * @param {object} params
 * @param {*} params.bannerId
 * @param {*} [params.page]
 * @param {*} [params.limit]
 * @returns {Promise<*>}
 * @throws {BadRequestError} 400 when the input breaks a rule.
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const getProductsByBannerService = async ({ bannerId, page = 1, limit = 10 }) => {
  if (!bannerId) {
    throw new BadRequestError("bannerId is required");
  }

  page = Number(page);
  limit = Number(limit);

  if (page < 1 || limit < 1) {
    throw new BadRequestError("Invalid pagination values");
  }

  const skip = (page - 1) * limit;
  const cacheKey = `BANNER:PRODUCTS:${bannerId}:${page}:${limit}`;

  /* ---------- CACHE CHECK ---------- */
  const cachedData = await getCache(cacheKey);
  if (cachedData) {
    logger.debug("CACHE HIT", { cacheKey });
    return cachedData;
  }

  /* ---------- FIND BANNER ---------- */
  const banner = await Banner.findOne({ bannerId, isActive: true }).lean();
  if (!banner) {
    throw new NotFoundError("Banner not found or inactive");
  }

  /* ---------- FILTER ---------- */
  const filter = { status: "active" };

  /* ---------- CATEGORY ---------- */
  if (banner.filterBy === "category") {
    const category = await Category.findOne({ categoryId: banner.filterId }).select("_id").lean();
    if (!category) {
      throw new NotFoundError("Category not found");
    }
    filter.category = category._id;
  } else if (banner.filterBy === "brand") {
    /* ---------- BRAND ---------- */
    const brand = await Brand.findOne({ brandId: banner.filterId }).select("_id").lean();
    if (!brand) {
      throw new NotFoundError("Brand not found", { code: ERROR_CODES.BRAND_NOT_FOUND });
    }
    filter.brand = brand._id;
  }

  /* ---------- FETCH PRODUCTS ---------- */
  const [products, totalItems] = await Promise.all([
    Product.find(filter)
      .populate("category", "categoryId name")
      .populate("brand", "brandId brandName logoUrl")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Product.countDocuments(filter),
  ]);

  const totalPages = Math.ceil(totalItems / limit);

  const result = {
    pagination: {
      totalItems,
      totalPages,
      currentPage: page,
      nextPage: page < totalPages ? page + 1 : null,
      prevPage: page > 1 ? page - 1 : null,
      limit,
    },
    banner: {
      bannerId: banner.bannerId,
      filterBy: banner.filterBy,
      filterId: banner.filterId,
      displayOrder: banner.displayOrder,
      imageUrl: banner.imageUrl,
    },
    products,
  };

  /* ---------- STORE CACHE ---------- */
  await setCache(cacheKey, result);

  return result;
};
