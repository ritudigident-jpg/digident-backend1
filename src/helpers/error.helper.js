/**
 * Send Error Response
 */

export const asyncHandler = (handler, fallbackStatus = 500) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (e) {
    sendError(res, e, fallbackStatus);
  }
};



export const ok = (res, data, status = 200) =>
  res.status(status).json({ success: true, ...data });
 

export const sendError = (
  res,
  {
    message = "Internal Server Error",
    statusCode = 500,
    errorCode = "INTERNAL_ERROR",
    details = null,
  } = {}
) => {
  const response = {
    success: false,
    message,
    statusCode,
    error: {
      code: errorCode,
    },
  };

  if (details) {
    response.error.details = details;
  }
  return res.status(statusCode).json(response);
};


/**
 * Global Error Handler
 */
export const handleError = (res, error) => {

  console.error("ERROR:", error);

  /* =========================
     AUTH / USER ERRORS
  ========================= */

  if (error.message === "EMAIL_EXISTS") {
    return sendError(res, {
      message: "Email already exists",
      statusCode: 409,
      errorCode: "EMAIL_EXISTS",
    });
  }

  if (error.message === "INVALID_CREDENTIALS") {
    return sendError(res, {
      message: "Invalid email or password",
      statusCode: 401,
      errorCode: "INVALID_CREDENTIALS",
    });
  }

  if (error.message === "USER_NOT_FOUND") {
    return sendError(res, {
      message: "User not found",
      statusCode: 404,
      errorCode: "USER_NOT_FOUND",
    });
  }

  if (error.message === "INVALID_OLD_PASSWORD") {
    return sendError(res, {
      message: "Old password is incorrect",
      statusCode: 401,
      errorCode: "INVALID_OLD_PASSWORD",
    });
  }

  /* =========================
     TOKEN ERRORS
  ========================= */

  if (error.message === "TOKEN_EXPIRED") {
    return sendError(res, {
      message: "Token expired",
      statusCode: 401,
      errorCode: "TOKEN_EXPIRED",
    });
  }

  if (error.message === "INVALID_TOKEN") {
    return sendError(res, {
      message: "Invalid token",
      statusCode: 401,
      errorCode: "INVALID_TOKEN",
    });
  }

  /* =========================
     RAZORPAY / EXTERNAL SDK ERRORS
  ========================= */

  if (error?.error?.description || error?.statusCode === 400) {
    return sendError(res, {
      message:
        error?.error?.description || error.message || "Request could not be processed",
      statusCode: error.statusCode && error.statusCode < 500 ? error.statusCode : 400,
      errorCode: error?.error?.code || "BAD_REQUEST",
    });
  }

  /* =========================
     DEFAULT ERROR
  ========================= */

  return sendError(res, {
    message: error.message || "Internal Server Error",
    statusCode: error.statusCode && error.statusCode >= 400 && error.statusCode < 600
      ? error.statusCode
      : 500,
    errorCode: "INTERNAL_ERROR",
  });
};