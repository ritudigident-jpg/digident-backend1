import Customer from "../models/ecommarace/libraryLog.model.js";
import EmailVerifyDummy from "../models/ecommarace/dummyemailverify.model.js";
import { otpVerificationTemplate } from "../config/templates/otpEmailTemplate.js";
import { sendZohoMail } from "./ZohoEmail/zohoMail.service.js";
import { v6 as uuidv6 } from "uuid";
import { adminLibraryRequestTemplate} from "../config/templates/adminLibraryRequestTemplat.js";
import { userLibraryRequestTemplate } from "../config/templates/userLibraryRequestTemplat.js";
/**
 * @function sendEmailOtpService
 *
 * @params
 * {
 *   email
 * }
 *
 * @process
 * 1. Find customer by email
 * 2. If already verified, return isVerified true
 * 3. Generate OTP and expiry
 * 4. Save or update OTP in EmailVerifyDummy
 * 5. Send OTP email
 *
 * @returns
 * {
 *   isVerified: Boolean
 * }
 */
export const sendEmailOtpService = async ({ email }) => {
  /* ---------- FIND CUSTOMER ---------- */
  const customer = await Customer.findOne({ email });

  /* ---------- IF EMAIL ALREADY VERIFIED ---------- */
  if (customer && customer.isEmailVerified) {
    return { isVerified: true };
  }

  /* ---------- GENERATE OTP ---------- */
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const otpExpiry = new Date(Date.now() + 5 * 60 * 1000);

  /* ---------- SAVE OR UPDATE OTP ---------- */
  await EmailVerifyDummy.findOneAndUpdate(
    { email },
    { email, otp, otpExpiry },
    { upsert: true, new: true }
  );

  /* ---------- SEND OTP EMAIL ---------- */
  const htmlBody = otpVerificationTemplate(email, otp);

  await sendZohoMail(
    email,
    "Your OTP for Email Verification",
    htmlBody
  );

  return { isVerified: false };
};

const ADMIN_EMAILS = process.env.ADMIN_EMAILS?.split(",") || [];

export const verifyOtpAndCreateCustomerService = async ({
  email,
  otp,
  libraryObjectId,
  libraryId,
  brandName,
  category,
  firstName,
  lastName,
  mobileNumber,
  companyName,
  address
}) => {
  /* ---------- NORMALIZE EMAIL ---------- */
  const normalizedEmail = email.toLowerCase().trim();

  /* ---------- FIND EXISTING CUSTOMER ---------- */
  const existingUser = await Customer.findOne({ email: normalizedEmail });

  /* ---------- SEND LIBRARY REQUEST EMAILS FOR SCANBRIDGE ---------- */
  if (category.toLowerCase() === "scanbridge") {
    await sendZohoMail(
      ADMIN_EMAILS.join(","),
      `New Library Request for ${brandName} - ${category}`,
      adminLibraryRequestTemplate(normalizedEmail, brandName, category)
    );

    await sendZohoMail(
      normalizedEmail,
      "Your Library Request Has Been Received",
      userLibraryRequestTemplate(brandName, category)
    );
  }

  /* ---------- IF CUSTOMER ALREADY VERIFIED ---------- */
  if (existingUser && existingUser.isEmailVerified) {
    await Customer.updateOne(
      { _id: existingUser._id },
      {
        $push: {
          logLibrary: {
            libraryObjectId,
            libraryId,
            brandName,
            category,
            date: new Date()
          }
        }
      }
    );

    return {
      userId: existingUser._id,
      email: existingUser.email,
      isVerified: true,
      message: "Email already verified, library log updated"
    };
  }

  /* ---------- VALIDATE OTP ---------- */
  if (!otp) {
    const error = new Error("OTP is required");
    error.statusCode = 400;
    error.errorCode = "OTP_REQUIRED";
    throw error;
  }

  const otpRecord = await EmailVerifyDummy.findOne({
    email: normalizedEmail
  });

  if (!otpRecord) {
    const error = new Error("OTP not found. Please request again.");
    error.statusCode = 400;
    error.errorCode = "OTP_NOT_FOUND";
    throw error;
  }

  if (otpRecord.otp !== otp) {
    const error = new Error("Invalid OTP");
    error.statusCode = 400;
    error.errorCode = "INVALID_OTP";
    throw error;
  }

  if (otpRecord.otpExpiry < new Date()) {
    await EmailVerifyDummy.deleteOne({ email: normalizedEmail });

    const error = new Error("OTP expired. Please request again.");
    error.statusCode = 400;
    error.errorCode = "OTP_EXPIRED";
    throw error;
  }

  /* ---------- CREATE CUSTOMER ---------- */
  const customer = await Customer.create({
    customerId: uuidv6(),
    firstName,
    lastName,
    email: normalizedEmail,
    mobileNumber,
    companyName,
    address,
    isEmailVerified: true,
    logLibrary: [
      {
        libraryObjectId,
        libraryId,
        brandName,
        category,
        date: new Date()
      }
    ]
  });

  /* ---------- DELETE USED OTP ---------- */
  await EmailVerifyDummy.deleteOne({ email: normalizedEmail });

  return {
    userId: customer._id,
    email: customer.email,
    isVerified: true,
    message: "OTP verified and customer created successfully"
  };
};

export const getAllConsumersService = async ({ skip, limit, page }) => {

  const [users, totalUsers] = await Promise.all([
    Customer.find({})
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),

    Customer.countDocuments()
  ]);

  return {
    users,
    pagination: {
      currentPage: page,
      totalPages: Math.ceil(totalUsers / limit),
      totalUsers,
      limit
    }
  };
};

export const getEmailVerifyDummyService = async ({
  email,
  skip,
  limit,
  page
}) => {

  const filter = {};

  if (email) {
    filter.email = email.toLowerCase();
  }

  const [records, total] = await Promise.all([
    EmailVerifyDummy.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),

    EmailVerifyDummy.countDocuments(filter)
  ]);

  return {
    records,
    pagination: {
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      totalRecords: total,
      limit
    }
  };
};

export const getLibraryDashboardService = async ({
  days,
  groupBy,
  limit,
  categoryFilter,
  brandFilter,
}) => {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  /* ---------- MATCH STAGE ---------- */
  const matchStage = {
    "logLibrary.date": { $gte: startDate },
  };

  if (categoryFilter) matchStage["logLibrary.category"] = categoryFilter;
  if (brandFilter) matchStage["logLibrary.brandName"] = brandFilter;

  /* ---------- GROUP STAGE ---------- */
  let groupStage;

  switch (groupBy) {
    case "category":
      groupStage = {
        _id: "$logLibrary.category",
        usageCount: { $sum: 1 },
        lastUsedAt: { $max: "$logLibrary.date" },
      };
      break;

    case "brand":
      groupStage = {
        _id: "$logLibrary.brandName",
        usageCount: { $sum: 1 },
        lastUsedAt: { $max: "$logLibrary.date" },
      };
      break;

    default:
      groupStage = {
        _id: "$logLibrary.libraryObjectId",
        libraryId: { $first: "$logLibrary.libraryId" },
        brandName: { $first: "$logLibrary.brandName" },
        category: { $first: "$logLibrary.category" },
        usageCount: { $sum: 1 },
        lastUsedAt: { $max: "$logLibrary.date" },
      };
  }

  /* ---------- AGGREGATION ---------- */
  const data = await Customer.aggregate([
    { $unwind: "$logLibrary" },
    { $match: matchStage },
    { $group: groupStage },
    { $sort: { usageCount: -1 } },
    { $limit: limit },
  ]);

  return {
    days,
    groupBy,
    category: categoryFilter || "All",
    brand: brandFilter || "All",
    total: data.length,
    data,
  };
};


export const deleteOtpByEmailService = async (email) => {
  const deletedRecord = await EmailVerifyDummy.findOneAndDelete({
    email: email.toLowerCase(),
  });

  if (!deletedRecord) {
    const error = new Error("No OTP record found for this email");
    error.statusCode = 404;
    error.errorCode = "OTP_NOT_FOUND";
    throw error;
  }

  return deletedRecord;
};