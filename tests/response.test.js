/**
 * Every success response has { success: true, message, statusCode, data, meta? }.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  sendSuccess,
  sendCreated,
  sendPaginated,
  buildPaginationMeta,
} from "../src/helpers/response.helper.js";
import { createResponse } from "./helpers.js";

describe("response helper", () => {
  test("sendSuccess sends the standard shape", () => {
    const res = createResponse();
    sendSuccess(res, { data: { id: 1 }, message: "Fetched" });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { success: true, message: "Fetched", statusCode: 200, data: { id: 1 } });
  });

  test("data defaults to null and message to Success", () => {
    const res = createResponse();
    sendSuccess(res);
    assert.deepEqual(res.body, { success: true, message: "Success", statusCode: 200, data: null });
  });

  test("sendCreated uses 201", () => {
    const res = createResponse();
    sendCreated(res, { data: { id: 2 }, message: "Created" });
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.statusCode, 201);
  });

  test("legacyTopLevel keeps old keys next to data (lead list)", () => {
    const res = createResponse();
    const result = { leads: [1, 2], total: 2, page: 1, totalPages: 1 };
    sendSuccess(res, { legacyTopLevel: result });
    assert.deepEqual(res.body.data, result);
    assert.deepEqual(res.body.leads, [1, 2]);
    assert.equal(res.body.total, 2);
    assert.equal(res.body.success, true);
  });

  test("legacyTopLevel with its own data key: data stays the old data", () => {
    const res = createResponse();
    sendSuccess(res, { legacyTopLevel: { data: [1], count: 1 } });
    assert.deepEqual(res.body.data, [1]);
    assert.equal(res.body.count, 1);
  });

  test("pagination meta", () => {
    assert.deepEqual(buildPaginationMeta({ page: 2, limit: 10, total: 35 }), {
      page: 2,
      limit: 10,
      total: 35,
      totalPages: 4,
      hasNext: true,
      hasPrev: true,
    });
    assert.deepEqual(buildPaginationMeta({ page: 1, limit: 10, total: 0 }), {
      page: 1,
      limit: 10,
      total: 0,
      totalPages: 0,
      hasNext: false,
      hasPrev: false,
    });
    const res = createResponse();
    sendPaginated(res, { data: [], pagination: { page: 1, limit: 10, total: 0 } });
    assert.equal(res.body.meta.totalPages, 0);
  });
});
