/**
 * Permission names used by the attendance, leave, payroll and employee-profile endpoints.
 * Unlike the older routes (which read the permission name from the request), these are fixed on the
 * server in the route file: router.get("/", auth, requirePermission(PERMISSIONS.PAYROLL_READ), ...).
 * scripts/seedhrpermissions.js creates them and gives them to Super Admin and Admin.
 *
 * Used by: middlewares/permission.middleware.js, routes/*.routes.js, services that check ownership
 */
export const PERMISSIONS = Object.freeze({
  HOLIDAY_MANAGE: "attendance.holiday.manage",
  TEAM_ATTENDANCE_READ: "attendance.team.read",
  PAYROLL_READ: "payroll.salary.read",
  PAYROLL_UPDATE: "payroll.salary.update",
  PAYROLL_FINALIZE: "payroll.month.finalize",
  PAYROLL_SETTINGS_UPDATE: "payroll.settings.update",
  PROFILE_READ: "employee.profile.read",
  PROFILE_UPDATE: "employee.profile.update",
  SENSITIVE_READ: "employee.sensitive.read",
  DOCUMENT_READ: "employee.document.read",
  DOCUMENT_VERIFY: "employee.document.verify",
});

/** Roles that hold every permission (0 Super Admin, 1 Admin) - same as the existing behaviour. */
export const ROLES = Object.freeze({ SUPER_ADMIN: 0, ADMIN: 1, MANAGER: 2, EXECUTIVE: 3, AGENT: 4 });
