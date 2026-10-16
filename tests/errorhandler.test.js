/**
 * The global error handler must always send the one error format:
 * { success: false, message, statusCode, error: { code, details? }, requestId }.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { errorHandler, notFoundHandler, classifyError } from "../src/middlewares/error.middleware.js";
import {
  NotFoundError,
  ValidationError,
  ExternalServiceError,
  AppError,
} from "../src/helpers/apperror.helper.js";
import { createRequest, createResponse } from "./helpers.js";

const run = (error) => {
  const res = createResponse();
  errorHandler(error, createRequest(), res, () => {});
  return res;
};

const assertErrorShape = (body, statusCode) => {
  assert.equal(body.success, false);
  assert.equal(body.statusCode, statusCode);
  assert.equal(typeof body.message, "string");
  assert.equal(typeof body.error.code, "string");
  assert.equal(body.requestId, "test-request-id");
};

describe("errorHandler", () => {
  let previousEnv;
  beforeEach(() => {
    previousEnv = process.env.NODE_ENV;
    process.env.LOG_LEVEL = "error";
  });
  afterEach(() => {
    process.env.NODE_ENV = previousEnv;
  });

  test("AppError keeps its status, message and code", () => {
    const res = run(new NotFoundError("Order not found", { code: "ORDER_NOT_FOUND" }));
    assert.equal(res.statusCode, 404);
    assertErrorShape(res.body, 404);
    assert.equal(res.body.message, "Order not found");
    assert.equal(res.body.error.code, "ORDER_NOT_FOUND");
  });

  test("ValidationError from Joi lists every field", () => {
    const joiError = {
      details: [
        { path: ["email"], message: '"email" is required' },
        { path: ["items", 0, "qty"], message: '"qty" must be a number' },
      ],
    };
    const res = run(ValidationError.fromJoi(joiError));
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error.code, "VALIDATION_ERROR");
    assert.deepEqual(res.body.error.details, [
      { field: "email", message: '"email" is required' },
      { field: "items.0.qty", message: '"qty" must be a number' },
    ]);
  });

  test("legacy new Error('EMAIL_EXISTS') keeps the old 409 and message", () => {
    const res = run(new Error("EMAIL_EXISTS"));
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.message, "Email already exists");
    assert.equal(res.body.error.code, "EMAIL_EXISTS");
  });

  test("legacy thrown object { statusCode, message, errorCode } is honoured", () => {
    const res = run({
      message: "Today is a Holiday",
      statusCode: 403,
      errorCode: "HOLIDAY_BLOCK",
      details: ["closed"],
    });
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error.code, "HOLIDAY_BLOCK");
    assert.deepEqual(res.body.error.details, [{ message: "closed" }]);
  });

  test("Mongo duplicate key -> 409 DUPLICATE_KEY", () => {
    const res = run({ code: 11000, keyValue: { email: "a@b.c" } });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error.code, "DUPLICATE_KEY");
  });

  test("Mongoose CastError -> 400 INVALID_ID", () => {
    const res = run({ name: "CastError", path: "_id", value: "abc", kind: "ObjectId" });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error.code, "INVALID_ID");
  });

  test("expired JWT -> 401 TOKEN_EXPIRED", () => {
    const res = run({ name: "TokenExpiredError", message: "jwt expired" });
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error.code, "TOKEN_EXPIRED");
  });

  test("invalid JSON body -> 400 INVALID_JSON", () => {
    const res = run({ type: "entity.parse.failed", message: "Unexpected token" });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error.code, "INVALID_JSON");
  });

  test("CORS rejection -> 403 CORS_BLOCKED", () => {
    const res = run(new Error("CORS Blocked"));
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error.code, "CORS_BLOCKED");
  });

  test("Razorpay SDK error -> 400 with the Razorpay description", () => {
    const res = run({
      statusCode: 400,
      error: { code: "BAD_REQUEST_ERROR", description: "The amount must be atleast INR 1.00" },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.message, "The amount must be atleast INR 1.00");
    assert.equal(res.body.error.code, "BAD_REQUEST_ERROR");
  });

  test("external failure -> 502", () => {
    const res = run(new ExternalServiceError("Zoho Mail Sending Failed", { cause: new Error("timeout") }));
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.error.code, "EXTERNAL_SERVICE_ERROR");
  });

  test("unknown error in production: generic message, no stack, no details", () => {
    process.env.NODE_ENV = "production";
    const res = run(new Error("connection string mongodb://secret"));
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.message, "Something went wrong");
    assert.equal(res.body.error.stack, undefined);
    assert.equal(res.body.error.code, "INTERNAL_ERROR");
  });

  test("unknown error in development shows the message and stack", () => {
    process.env.NODE_ENV = "development";
    const res = run(new Error("boom"));
    assert.equal(res.body.message, "boom");
    assert.ok(res.body.error.stack);
  });

  test("a 500 AppError hides its message in production", () => {
    process.env.NODE_ENV = "production";
    const res = run(new AppError("Webhook secret not configured"));
    assert.equal(res.body.message, "Something went wrong");
  });

  test("nothing is sent twice when headers are already sent", () => {
    const res = createResponse();
    res.headersSent = true;
    errorHandler(new Error("late"), createRequest(), res, () => {});
    assert.equal(res.body, undefined);
  });
});

describe("notFoundHandler", () => {
  test("unknown route -> 404 ROUTE_NOT_FOUND", () => {
    let passed;
    notFoundHandler(
      createRequest({ method: "POST", originalUrl: "/nope" }),
      createResponse(),
      (error) => (passed = error)
    );
    assert.equal(classifyError(passed).statusCode, 404);
    assert.equal(passed.code, "ROUTE_NOT_FOUND");
  });
});
