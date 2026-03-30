export const sendEmailOtpService = async ({
  email,
  libraryObjectId,
  libraryId,
  brandName,
  category
}) => {
  /* ---------- FIND CUSTOMER ---------- */
  const customer = await Customer.findOne({ email });
  /* ---------- IF VERIFIED ---------- */
  if (customer && customer.isEmailVerified){
    await Customer.updateOne(
      { _id: customer._id },
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
    return { isVerified: true };
  }

  /* ---------- GENERATE OTP ---------- */
  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  const otpExpiry = new Date(Date.now() + 5 * 60 * 1000);

  /* ---------- SAVE OTP ---------- */
  await EmailVerifyDummy.findOneAndUpdate(
    { email },
    { email, otp, otpExpiry },
    { upsert: true, new: true }
  );

  /* ---------- SEND EMAIL ---------- */
  const htmlBody = otpVerificationTemplate(email, otp);

  await sendZohoMail(
    email,
    "Your OTP for Email Verification",
    htmlBody
  );

  return { isVerified: false };
};

export const verifyOtpAndCreateCustomerService = async (data) => {
  const { email, otp, ...restBody } = data;
  const normalizedEmail = email.toLowerCase();
  /* ---------- VERIFY OTP ---------- */
  const otpRecord = await EmailVerifyDummy.findOne({
    email: normalizedEmail
  });
  if (!otpRecord) {
    throw {
      message: "OTP not found. Please request again.",
      statusCode: 400
    };
  }
  if (otpRecord.otp !== otp) {
    throw {
      message: "Invalid OTP",
      statusCode: 400
    };
  }

  if (otpRecord.otpExpiry < new Date()) {
    await EmailVerifyDummy.deleteOne({ email: normalizedEmail });

    throw {
      message: "OTP expired. Please request again.",
      statusCode: 400
    };
  }

  /* ---------- CHECK EXISTING CUSTOMER ---------- */
  const existingCustomer = await Customer.findOne({
    email: normalizedEmail
  });

  if (existingCustomer) {
    return {
      message: "Email already verified",
      userId: existingCustomer._id,
      email: existingCustomer.email,
      isVerified: true
    };
  }

  /* ---------- CREATE CUSTOMER ---------- */
  const customer = await Customer.create({
    customerId: uuidv6(),
    ...restBody,
    email: normalizedEmail,
    isEmailVerified: true
  });

  /* ---------- DELETE OTP ---------- */
  await EmailVerifyDummy.deleteOne({ email: normalizedEmail });

  return {
    message: "OTP verified and customer created",
    userId: customer._id,
    email: customer.email,
    isVerified: true
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

// services/emailVerify.service.js

import EmailVerifyDummy from "../models/emailVerifyDummyModel.js";

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