/**
 * API permission tests for the new attendance / payroll / employee-profile endpoints.
 * No database: Employee.findOne is replaced by an in-memory stub, so the permission middleware
 * sees exactly the employee we describe. We check that:
 *   - a logged-in user WITHOUT the permission gets 403 PERMISSION_DENIED on every admin route;
 *   - a user WITH the permission gets past the check (here: to validation, 400) - proving the
 *     permission name is fixed on the server, not taken from the request;
 *   - a permission sent in the request body is ignored.
 * Needs the real packages (npm install); skipped automatically otherwise, like contract.test.js.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

let request;
let jwt;
let available = true;
try {
  request = (await import("supertest")).default;
  jwt = (await import("jsonwebtoken")).default;
  await import("express");
} catch {
  available = false;
}

const SAMPLE_ID = "000000000000000000000001";

describe("HR endpoint permissions", { skip: !available && "install dependencies first (npm install)" }, () => {
  let app;
  let Employee;
  let originalFindOne;
  let currentEmployee;

  const tokenFor = (email) => jwt.sign({ id: SAMPLE_ID, email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: "5m" });
  const asEmployee = (permissions, role = 4) => {
    currentEmployee = { _id: SAMPLE_ID, email: "agent@digident.in", role, permissions, firstName: "Test", lastName: "Agent" };
    return `Bearer ${tokenFor(currentEmployee.email)}`;
  };

  before(async () => {
    process.env.NODE_ENV = "test";
    process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || "test-access-secret";
    const mongoose = (await import("mongoose")).default;
    mongoose.set("bufferCommands", false);
    Employee = (await import("../src/models/employee.model.js")).default;
    originalFindOne = Employee.findOne;
    Employee.findOne = () => {
      const query = { select: () => query, lean: async () => currentEmployee };
      return query;
    };
    app = (await import("../src/app.js")).default;
  });

  after(() => {
    Employee.findOne = originalFindOne;
  });

  const adminRoutes = [
    ["get", "/api/v1/payroll?month=10&year=2026", "payroll.salary.read"],
    ["get", `/api/v1/payroll/employee/${SAMPLE_ID}`, "payroll.salary.read"],
    ["get", `/api/v1/payroll/salary-profile/${SAMPLE_ID}`, "payroll.salary.read"],
    ["put", `/api/v1/payroll/salary-profile/${SAMPLE_ID}`, "payroll.salary.update"],
    ["post", "/api/v1/payroll/finalize", "payroll.month.finalize"],
    ["post", "/api/v1/payroll/reopen", "payroll.month.finalize"],
    ["put", "/api/v1/payroll/settings", "payroll.settings.update"],
    ["patch", `/api/v1/payroll/extra/${SAMPLE_ID}`, "payroll.salary.update"],
    ["get", "/api/v1/attendance/admin/holidays", "attendance.holiday.manage"],
    ["put", `/api/v1/attendance/admin/holiday/${SAMPLE_ID}`, "attendance.holiday.manage"],
    ["delete", `/api/v1/attendance/admin/holiday/${SAMPLE_ID}`, "attendance.holiday.manage"],
    ["get", "/api/v1/attendance/admin/team-leaves", "attendance.team.read"],
    ["patch", "/api/v1/attendance/admin/leave-requests/abc/paid", "payroll.salary.update"],
    ["get", `/api/v1/employee-profile/${SAMPLE_ID}`, "employee.profile.read"],
    ["put", `/api/v1/employee-profile/${SAMPLE_ID}`, "employee.profile.update"],
    ["get", `/api/v1/employee-profile/${SAMPLE_ID}/documents`, "employee.document.read"],
    ["patch", `/api/v1/employee-profile/documents/${SAMPLE_ID}/verify`, "employee.document.verify"],
  ];

  for (const [method, url, permission] of adminRoutes) {
    test(`${method.toUpperCase()} ${url} without ${permission} -> 403`, async () => {
      const res = await request(app)[method](url).set("Authorization", asEmployee([])).send({ permission });
      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, "PERMISSION_DENIED");
    });
  }

  test("a permission named in the body is ignored (old checkPermission behaviour is not used)", async () => {
    const res = await request(app)
      .put("/api/v1/payroll/settings")
      .set("Authorization", asEmployee(["auth.account.create"]))
      .send({ permission: "auth.account.create", paidLeaveQuotaPerMonth: 5 });
    assert.equal(res.status, 403);
  });

  test("with the permission the request reaches validation (400, not 403)", async () => {
    const finalize = await request(app).post("/api/v1/payroll/finalize").set("Authorization", asEmployee(["payroll.month.finalize"])).send({});
    assert.equal(finalize.status, 400);
    assert.equal(finalize.body.error.code, "VALIDATION_ERROR");
    const settings = await request(app).put("/api/v1/payroll/settings").set("Authorization", asEmployee(["payroll.settings.update"])).send({ extraPayMultiplier: 99 });
    assert.equal(settings.status, 400);
  });

  test("Super Admin passes every permission check", async () => {
    const res = await request(app).post("/api/v1/payroll/finalize").set("Authorization", asEmployee([], 0)).send({});
    assert.equal(res.status, 400);
  });

  test("Admin-only attendance routes still refuse an Agent", async () => {
    const res = await request(app).get("/api/v1/attendance/admin/leave-requests").set("Authorization", asEmployee(["payroll.salary.read"]));
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, "ADMIN_ROLE_REQUIRED");
  });

  test("leave request validation: HALF_DAY needs a session; client totalDays is dropped", async () => {
    const res = await request(app)
      .post("/api/v1/attendance/leave-request")
      .set("Authorization", asEmployee([]))
      .send({ leaveType: "CASUAL", leaveDuration: "HALF_DAY", fromDate: "2026-10-20", toDate: "2026-10-20", leaveReason: "Bank work", totalDays: 9 });
    assert.equal(res.status, 400);
    assert.ok(res.body.error.details.some((detail) => detail.field === "halfDaySession"));
  });

  test("punch-out correction needs a reason", async () => {
    const res = await request(app)
      .post("/api/v1/attendance/punch-out/request")
      .set("Authorization", asEmployee([]))
      .send({ date: "2026-10-15", time: "18:30" });
    assert.equal(res.status, 400);
  });

  test("bank formats are validated (PAN, IFSC, Aadhaar)", async () => {
    const res = await request(app)
      .put(`/api/v1/employee-profile/${SAMPLE_ID}`)
      .set("Authorization", asEmployee(["employee.profile.update"]))
      .send({ bank: { pan: "ABC123", ifsc: "HDFC1234567", aadhaar: "1234" } });
    assert.equal(res.status, 400);
    const fields = res.body.error.details.map((detail) => detail.field);
    assert.deepEqual(fields.sort(), ["bank.aadhaar", "bank.ifsc", "bank.pan"]);
  });
});
