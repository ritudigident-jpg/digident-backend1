/**
 * Business logic for CAD library downloads (OTP-verified customers and download logs). Throws
 * AppError subclasses on failure.
 *
 * Exports: sendEmailOtpService, verifyOtpAndCreateCustomerService, getAllConsumersService,
 * getEmailVerifyDummyService, getLibraryDashboardService, deleteOtpByEmailService,
 * getScanbridgeLibraryService, updateScanbridgeLibraryService
 * Used by: controllers/librarylog/librarylog.controller.js
 */

import CustomerData from "../../models/customerdata.model.js";
import EmailVerifyDummy from "../../models/dummyemailverify.model.js";
import { otpVerificationTemplate } from "../../templates/email/otp.template.js";
import { sendZohoMail } from "../zoho/zohomail.service.js";
import { v6 as uuidv6 } from "uuid";
import { adminLibraryRequestTemplate } from "../../templates/email/adminlibraryrequest.template.js";
import { userLibraryRequestTemplate } from "../../templates/email/userlibraryrequest.template.js";
import { ADMIN_EMAILS } from "../../config/mail.config.js";
import { sendNotification } from "../notification/notification.service.js";
import { redis as redisClient } from "../../config/redis.config.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import { BadRequestError, NotFoundError } from "../../helpers/apperror.helper.js";
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
    const cached = await redisClient.get(key);
    if (!cached) return null;
    return JSON.parse(cached);
  } catch (err) {
    logger.error("REDIS GET CACHE ERROR", { error: err.message });
    return null;
  }
};

const setCache = async (key, data) => {
  try {
    await redisClient.set(key, JSON.stringify(data), { ex: CACHE_TTL });
  } catch (err) {
    logger.error("REDIS SET CACHE ERROR", { error: err.message });
  }
};

const clearLibraryCache = async () => {
  try {
    const keys = await redisClient.keys("LIBRARY:*");
    if (keys.length > 0) {
      await redisClient.del(...keys);
      logger.debug("LIBRARY CACHE CLEARED", { keys });
    }
  } catch (err) {
    logger.error("REDIS LIBRARY CACHE CLEAR ERROR", { error: err.message });
  }
};

/* =========================================================
   LIBRARY LOG HELPERS (software -> library nested model)
========================================================= */
const escapeRegex = (value = "") => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Pushes a log entry into the matching software's library array
 * (matched by brandName + category, case-insensitive). If this
 * customer has no software entry with that brand+category yet,
 * creates a new software entry with this log as its first library item.
 *
 * Implemented as two atomic updateOne calls (try-push-to-existing,
 * fallback-to-create-new) instead of fetch+mutate+save, so it keeps
 * the same atomicity guarantee the old `$push` into `logLibrary` had.
 */
const pushLibraryLog = async (customerId, { brandName, category, logEntry }) => {
  const brandRegex = new RegExp(`^${escapeRegex(brandName.trim())}$`, "i");
  const categoryRegex = new RegExp(`^${escapeRegex(category.trim())}$`, "i");

  const pushedToExisting = await CustomerData.updateOne(
    {
      _id: customerId,
      software: { $elemMatch: { brandName: brandRegex, category: categoryRegex } },
    },
    { $push: { "software.$[sw].library": logEntry } },
    { arrayFilters: [{ "sw.brandName": brandRegex, "sw.category": categoryRegex }] }
  );

  if (pushedToExisting.modifiedCount === 0) {
    await CustomerData.updateOne(
      { _id: customerId },
      { $push: { software: { brandName, category, library: [logEntry] } } }
    );
  }
};

/* =========================================================
   SEND EMAIL OTP
========================================================= */
/**
 * Send email OTP.
 *
 * @param {object} params
 * @param {*} params.email
 * @returns {Promise<*>}
 */
export const sendEmailOtpService = async ({ email }) => {
  const customer = await CustomerData.findOne({ email });

  if (customer && customer.isEmailVerified) {
    return { isVerified: true };
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const otpExpiry = new Date(Date.now() + 5 * 60 * 1000);

  await EmailVerifyDummy.findOneAndUpdate({ email }, { email, otp, otpExpiry }, { upsert: true, new: true });

  const htmlBody = otpVerificationTemplate(email, otp);
  await sendZohoMail(email, "Your OTP for Email Verification", htmlBody);

  return { isVerified: false };
};

/* =========================================================
   VERIFY OTP & CREATE CUSTOMER (now pushes into software.library)
========================================================= */
/**
 * Verify OTP and create customer.
 *
 * @param {object} params
 * @param {*} params.email
 * @param {*} params.otp
 * @param {*} params.libraryObjectId
 * @param {*} params.libraryId
 * @param {*} params.brand
 * @param {*} params.category
 * @param {*} params.firstName
 * @param {*} params.lastName
 * @param {*} params.mobileNumber
 * @param {*} params.companyName
 * @param {*} params.address
 * @returns {Promise<*>}
 * @throws {BadRequestError} 400 when the input breaks a rule.
 */
export const verifyOtpAndCreateCustomerService = async ({
  email,
  otp,
  libraryObjectId,
  libraryId,
  brand,
  category,
  firstName,
  lastName,
  mobileNumber,
  companyName,
  address,
}) => {
  const normalizedEmail = email.toLowerCase().trim();

  const isScanbridge = category?.toLowerCase() === "scanbridge";

  /* ---------- VALIDATE REQUIRED IDS FOR NON-SCANBRIDGE ---------- */
  if (!isScanbridge) {
    if (!libraryId || !libraryObjectId) {
      throw new BadRequestError("libraryId and libraryObjectId are required", {
        code: ERROR_CODES.LIBRARY_DETAILS_REQUIRED,
      });
    }
  }

  const existingUser = await CustomerData.findOne({ email: normalizedEmail });

  /* ---------- SEND EMAILS FOR SCANBRIDGE ---------- */
  if (isScanbridge) {
    try {
      await sendZohoMail(
        ADMIN_EMAILS.join(","),
        `New Library Request for ${brand} - ${category}`,
        adminLibraryRequestTemplate(normalizedEmail, brand, category)
      );

      await sendZohoMail(
        normalizedEmail,
        "Your Library Request Has Been Received",
        userLibraryRequestTemplate(brand, category)
      );
    } catch (err) {
      logger.error("Scanbridge email failed", { error: err.message });
    }
  }

  /* ---------- BUILD LIBRARY LOG ENTRY (lives inside software.library now) ---------- */
  const libraryLogEntry = {
    date: new Date(),
  };

  /* ---------- ADD IDS ONLY FOR NON-SCANBRIDGE ---------- */
  if (!isScanbridge) {
    libraryLogEntry.libraryObjectId = libraryObjectId;
    libraryLogEntry.libraryId = libraryId;
  }

  logger.debug("Library Log Entry", { libraryLogEntry });

  /* ---------- EXISTING VERIFIED CUSTOMER ---------- */
  if (existingUser && existingUser.isEmailVerified) {
    await pushLibraryLog(existingUser._id, {
      brandName: brand,
      category,
      logEntry: libraryLogEntry,
    });

    await clearLibraryCache();

    try {
      await sendNotification({
        sender: null,
        permission: "library.listing.read",
        title: "Library Downloaded",
        message: `${normalizedEmail} downloaded "${brand}" library (${category})`,
        type: "LIBRARY_DOWNLOADED",
        entityId: existingUser._id,
        entityModel: "CustomerData",
        metadata: {
          customerId: existingUser._id,
          email: normalizedEmail,
          brand,
          category,
          ...(isScanbridge ? {} : { libraryId, libraryObjectId }),
        },
      });
    } catch (err) {
      logger.error("Notification failed on library download", { error: err.message });
    }

    return {
      userId: existingUser._id,
      email: existingUser.email,
      isVerified: true,
      message: "Email already verified, library log updated",
    };
  }

  /* ---------- VALIDATE OTP ---------- */
  if (!otp) {
    throw new BadRequestError("OTP is required", { code: ERROR_CODES.OTP_REQUIRED });
  }

  const otpRecord = await EmailVerifyDummy.findOne({ email: normalizedEmail });

  if (!otpRecord) {
    throw new BadRequestError("OTP not found. Please request again.", { code: ERROR_CODES.OTP_NOT_FOUND });
  }

  if (otpRecord.otp !== otp) {
    throw new BadRequestError("Invalid OTP", { code: ERROR_CODES.INVALID_OTP });
  }

  if (otpRecord.otpExpiry < new Date()) {
    await EmailVerifyDummy.deleteOne({ email: normalizedEmail });
    throw new BadRequestError("OTP expired. Please request again.", { code: ERROR_CODES.OTP_EXPIRED });
  }

  /* ---------- CREATE CUSTOMER WITH FIRST SOFTWARE ENTRY ---------- */
  const customer = await CustomerData.create({
    customerId: uuidv6(),
    firstName,
    lastName,
    email: normalizedEmail,
    mobileNumber,
    companyName,
    address,
    isEmailVerified: true,
    software: [
      {
        brandName: brand,
        category,
        library: [libraryLogEntry],
      },
    ],
  });

  await EmailVerifyDummy.deleteOne({ email: normalizedEmail });

  await clearLibraryCache();

  try {
    await sendNotification({
      sender: null,
      permission: "library.listing.read",
      title: "Library Downloaded",
      message: `${normalizedEmail} downloaded "${brand}" library (${category})`,
      type: "LIBRARY_DOWNLOADED",
      entityId: customer._id,
      entityModel: "CustomerData",
      metadata: {
        customerId: customer._id,
        email: normalizedEmail,
        brand,
        category,
        ...(isScanbridge ? {} : { libraryId, libraryObjectId }),
      },
    });
  } catch (err) {
    logger.error("Notification failed on library download", { error: err.message });
  }

  return {
    userId: customer._id,
    email: customer.email,
    isVerified: true,
    message: "OTP verified and customer created successfully",
  };
};

/* =========================================================
   GET ALL CONSUMERS  (unchanged — no logLibrary-specific code)
========================================================= */
/**
 * Get all consumers.
 *
 * @param {object} params
 * @param {*} params.skip
 * @param {*} params.limit
 * @param {*} params.page
 * @returns {Promise<*>}
 */
export const getAllConsumersService = async ({ skip, limit, page }) => {
  const cacheKey = `LIBRARY:CONSUMERS:${page}:${limit}`;

  const cached = await getCache(cacheKey);
  if (cached) {
    logger.debug("LIBRARY CACHE HIT", { cacheKey });
    return cached;
  }

  const [users, totalItems] = await Promise.all([
    CustomerData.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    CustomerData.countDocuments(),
  ]);

  const totalPages = Math.ceil(totalItems / limit);

  const result = {
    users,
    pagination: {
      totalItems,
      totalPages,
      currentPage: page,
      nextPage: page < totalPages ? page + 1 : null,
      prevPage: page > 1 ? page - 1 : null,
      limit,
    },
  };

  await setCache(cacheKey, result);
  return result;
};

/* =========================================================
   GET EMAIL VERIFY DUMMY (unchanged)
========================================================= */
/**
 * Get email verify dummy.
 *
 * @param {object} params
 * @param {*} params.email
 * @param {*} params.skip
 * @param {*} params.limit
 * @param {*} params.page
 * @returns {Promise<*>}
 */
export const getEmailVerifyDummyService = async ({ email, skip, limit, page }) => {
  const filter = {};
  if (email) filter.email = email.toLowerCase();

  const [records, totalItems] = await Promise.all([
    EmailVerifyDummy.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    EmailVerifyDummy.countDocuments(filter),
  ]);

  const totalPages = Math.ceil(totalItems / limit);

  return {
    records,
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

/* =========================================================
   GET LIBRARY DASHBOARD (now double-unwinds software -> library)
========================================================= */
/**
 * Get library dashboard.
 *
 * @param {object} params
 * @param {*} params.days
 * @param {*} params.groupBy
 * @param {*} params.limit
 * @param {*} params.categoryFilter
 * @param {*} params.brandFilter
 * @returns {Promise<*>}
 */
export const getLibraryDashboardService = async ({ days, groupBy, limit, categoryFilter, brandFilter }) => {
  const cacheKey = `LIBRARY:DASHBOARD:${days}:${groupBy}:${limit}:${categoryFilter || "all"}:${brandFilter || "all"}`;

  const cached = await getCache(cacheKey);
  if (cached) {
    logger.debug("LIBRARY CACHE HIT", { cacheKey });
    return cached;
  }

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const matchStage = {
    "software.library.date": { $gte: startDate },
  };
  if (categoryFilter) matchStage["software.category"] = categoryFilter;
  if (brandFilter) matchStage["software.brandName"] = brandFilter;

  let groupStage;
  switch (groupBy) {
    case "category":
      groupStage = {
        _id: "$software.category",
        usageCount: { $sum: 1 },
        lastUsedAt: { $max: "$software.library.date" },
      };
      break;
    case "brand":
      groupStage = {
        _id: "$software.brandName",
        usageCount: { $sum: 1 },
        lastUsedAt: { $max: "$software.library.date" },
      };
      break;
    default: // "library"
      groupStage = {
        _id: "$software.library.libraryObjectId",
        libraryId: { $first: "$software.library.libraryId" },
        brandName: { $first: "$software.brandName" },
        category: { $first: "$software.category" },
        usageCount: { $sum: 1 },
        lastUsedAt: { $max: "$software.library.date" },
      };
  }

  const data = await CustomerData.aggregate([
    { $unwind: "$software" },
    { $unwind: "$software.library" },
    { $match: matchStage },
    { $group: groupStage },
    { $sort: { usageCount: -1 } },
    { $limit: limit },
  ]);

  const result = {
    days,
    groupBy,
    category: categoryFilter || "All",
    brand: brandFilter || "All",
    total: data.length,
    data,
  };

  await setCache(cacheKey, result);
  return result;
};

/* =========================================================
   DELETE OTP BY EMAIL (unchanged)
========================================================= */
/**
 * Delete OTP by email.
 *
 * @param {*} email
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const deleteOtpByEmailService = async (email) => {
  const deletedRecord = await EmailVerifyDummy.findOneAndDelete({
    email: email.toLowerCase(),
  });

  if (!deletedRecord) {
    throw new NotFoundError("No OTP record found for this email", { code: ERROR_CODES.OTP_NOT_FOUND });
  }

  return deletedRecord;
};

/* =========================================================
   GET SCANBRIDGE LIBRARY (now flattens software -> library)
========================================================= */
/**
 * Get scanbridge library.
 *
 * @param {object} params
 * @param {*} [params.page]
 * @param {*} [params.limit]
 * @returns {Promise<*>}
 */
export const getScanbridgeLibraryService = async ({ page = 1, limit = 12 }) => {
  const currentPage = Number(page) || 1;
  const perPage = Number(limit) || 12;
  const skip = (currentPage - 1) * perPage;

  const cacheKey = `LIBRARY:SCANBRIDGE:${currentPage}:${perPage}`;

  const cached = await getCache(cacheKey);
  if (cached) {
    logger.debug("LIBRARY CACHE HIT", { cacheKey });
    return cached;
  }

  const customers = await CustomerData.find(
    { "software.category": { $regex: /^scanbridge$/i } },
    { firstName: 1, lastName: 1, email: 1, companyName: 1, mobileNumber: 1, software: 1 }
  ).lean();

  const scanbridgeLibrary = [];

  for (const customer of customers) {
    const scanbridgeSoftwareEntries = (customer.software || []).filter(
      (sw) => sw.category?.toLowerCase() === "scanbridge"
    );

    for (const sw of scanbridgeSoftwareEntries) {
      for (const log of sw.library || []) {
        scanbridgeLibrary.push({
          customerId: customer._id,
          firstName: customer.firstName,
          lastName: customer.lastName,
          email: customer.email,
          mobileNumber: customer.mobileNumber,
          companyName: customer.companyName,
          softwareId: sw._id,
          logId: log._id,
          brandName: sw.brandName || null,
          category: sw.category,
          isdelivered: log.isdelivered ?? false,
          date: log.date,
        });
      }
    }
  }

  scanbridgeLibrary.sort((a, b) => new Date(b.date) - new Date(a.date));

  const totalItems = scanbridgeLibrary.length;
  const totalPages = Math.ceil(totalItems / perPage);
  const paginatedScanbridgeLibrary = scanbridgeLibrary.slice(skip, skip + perPage);

  const result = {
    scanbridgeLibrary: paginatedScanbridgeLibrary,
    pagination: {
      totalItems,
      totalPages,
      currentPage,
      nextPage: currentPage < totalPages ? currentPage + 1 : null,
      prevPage: currentPage > 1 ? currentPage - 1 : null,
      limit: perPage,
    },
  };

  await setCache(cacheKey, result);
  return result;
};

/* =========================================================
   UPDATE SCANBRIDGE LIBRARY (now searches software[].library[])
========================================================= */
/**
 * Update scanbridge library.
 *
 * @param {object} params
 * @param {*} params.customerId
 * @param {*} params.softwareId
 * @param {*} params.logId
 * @param {*} params.isdelivered
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 * @throws {BadRequestError} 400 when the input breaks a rule.
 */
export const updateScanbridgeLibraryService = async ({
  customerId,
  softwareId, // optional — pass it if you have it (from getScanbridgeLibrary response) for a direct lookup
  logId,
  isdelivered,
}) => {
  const customer = await CustomerData.findById(customerId);

  if (!customer) {
    throw new NotFoundError("Customer not found", { code: ERROR_CODES.CUSTOMER_NOT_FOUND });
  }

  let softwareEntry;
  let libraryLog;

  if (softwareId) {
    softwareEntry = customer.software.find((sw) => sw._id.toString() === softwareId);
    libraryLog = softwareEntry?.library.find((log) => log._id.toString() === logId);
  } else {
    // Fallback: scan every software entry for this customer to find the log
    for (const sw of customer.software) {
      const match = sw.library.find((log) => log._id.toString() === logId);
      if (match) {
        softwareEntry = sw;
        libraryLog = match;
        break;
      }
    }
  }

  if (!softwareEntry || !libraryLog) {
    throw new NotFoundError("Log not found", { code: ERROR_CODES.LOG_NOT_FOUND });
  }

  if (softwareEntry.category?.toLowerCase() !== "scanbridge") {
    throw new BadRequestError("This log does not belong to a scanbridge category", {
      code: ERROR_CODES.INVALID_CATEGORY,
    });
  }

  libraryLog.isdelivered = isdelivered;
  await customer.save({ validateBeforeSave: false });

  await clearLibraryCache();

  return {
    customerId: customer._id,
    softwareId: softwareEntry._id,
    logId: libraryLog._id,
    brandName: softwareEntry.brandName,
    category: softwareEntry.category,
    isdelivered: libraryLog.isdelivered,
    date: libraryLog.date,
  };
};
