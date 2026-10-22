/**
 * Permission names used by the attendance, leave, payroll, employee-profile and task endpoints.
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
  // Task management (admin side). Employees need no permission to work on tasks assigned to them.
  TASK_READ: "task.manage.read",
  TASK_CREATE: "task.manage.create",
  TASK_UPDATE: "task.manage.update",
  TASK_DELETE: "task.manage.delete",
});

/** Roles that hold every permission (0 Super Admin, 1 Admin) - same as the existing behaviour. */
export const ROLES = Object.freeze({ SUPER_ADMIN: 0, ADMIN: 1, MANAGER: 2, EXECUTIVE: 3, AGENT: 4 });
