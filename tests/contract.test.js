/**
 * API contract test: walks docs/ENDPOINTS.md and checks that every error response has the one
 * error format. Needs the real packages (npm install); no database is used:
 *   - every route that starts with an auth middleware answers 401 without a token,
 *   - an unknown route answers 404,
 *   - a bad JSON body answers 400.
 * Skipped automatically when express / supertest are not installed.
 */
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const AUTH_FIRST = /^(auth|authToken|employeeVerifyAccessToken)\b/;
const SAMPLE_ID = "000000000000000000000000";

const loadEndpoints = () =>
  fs
    .readFileSync(new URL("../docs/ENDPOINTS.md", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => /^\| (GET|POST|PUT|PATCH|DELETE) \|/.test(line))
    .map((line) => {
      const [method, path, chain] = line.split(" | ").map((cell) => cell.replace(/^\|\s*|`/g, "").trim());
      return { method, path, chain };
    });

const assertErrorShape = (body, statusCode) => {
  assert.equal(body.success, false, "success must be false");
  assert.equal(body.statusCode, statusCode, "statusCode in body must match");
  assert.equal(typeof body.message, "string");
  assert.equal(typeof body.error?.code, "string");
  assert.equal(typeof body.requestId, "string");
};

let request;
let app;
let available = true;
try {
  request = (await import("supertest")).default;
  await import("express");
} catch {
  available = false;
}

describe("API contract", { skip: !available && "install dependencies first (npm install)" }, () => {
  before(async () => {
    process.env.NODE_ENV = "test";
    const mongoose = (await import("mongoose")).default;
    mongoose.set("bufferCommands", false);
    app = (await import("../src/app.js")).default;
  });

  test("unknown route -> 404 in the error format", async () => {
    const res = await request(app).get("/api/v1/this-route-does-not-exist");
    assert.equal(res.status, 404);
    assertErrorShape(res.body, 404);
    assert.equal(res.body.error.code, "ROUTE_NOT_FOUND");
  });

  test("invalid JSON body -> 400 INVALID_JSON", async () => {
    const res = await request(app)
      .post("/api/v1/user/login")
      .set("Content-Type", "application/json")
      .send("{bad json");
    assert.equal(res.status, 400);
    assertErrorShape(res.body, 400);
  });

  for (const endpoint of loadEndpoints().filter((item) => AUTH_FIRST.test(item.chain))) {
    test(`${endpoint.method} ${endpoint.path} without a token -> 401`, async () => {
      const url = endpoint.path.replace(/:[A-Za-z]+/g, SAMPLE_ID);
      const res = await request(app)[endpoint.method.toLowerCase()](url);
      assert.equal(res.status, 401);
      assertErrorShape(res.body, 401);
    });
  }
});
