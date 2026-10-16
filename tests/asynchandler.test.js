import { test } from "node:test";
import assert from "node:assert/strict";
import { asyncHandler } from "../src/helpers/asynchandler.helper.js";
import { BadRequestError } from "../src/helpers/apperror.helper.js";

test("asyncHandler passes thrown errors to next()", async () => {
  let received;
  const handler = asyncHandler(async () => {
    throw new BadRequestError("bad");
  });
  await handler({}, {}, (error) => (received = error));
  assert.ok(received instanceof BadRequestError);
  assert.equal(received.statusCode, 400);
});

test("asyncHandler returns the handler result and does not call next on success", async () => {
  let called = false;
  const handler = asyncHandler(async () => "done");
  const result = await handler({}, {}, () => (called = true));
  assert.equal(result, "done");
  assert.equal(called, false);
});

test("AppError keeps the original error as cause", () => {
  const original = new Error("socket hang up");
  const error = new BadRequestError("Invalid", { cause: original });
  assert.equal(error.cause, original);
  assert.equal(error.isOperational, true);
});
