# Digident Backend

One Express 5 + MongoDB (Mongoose) API behind four frontends: the online store, the public website, the
Manual Order Console and the CRM. Also runs Socket.IO (live notifications) and daily cron jobs.

## Run it

```bash
npm install
cp .env.example .env      # fill in the values; the server checks them at startup
npm run dev               # http://localhost:3000 (auto-reload)
npm start                 # production
```

Node 20.6 or newer. If a required variable is missing, the server prints which one and stops.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start with auto-reload (nodemon) |
| `npm start` | Start for production |
| `npm run lint` / `npm run lint:fix` | ESLint check / auto-fix |
| `npm run format` / `npm run format:check` | Prettier write / check |
| `npm test` | Unit tests and the API contract test (`tests/`) |
| `npm run endpoints` | Regenerate `docs/ENDPOINTS.md` from the route files |

## Read these first

| Document | What is in it |
|---|---|
| `docs/CODING_STANDARDS.md` | How we write code here, with GOOD / BAD examples from this codebase |
| `docs/API_CONVENTIONS.md` | The response and error format, status codes, error codes, rate limits |
| `docs/ENDPOINTS.md` | Every endpoint: method, path, middleware chain, handler |
| `docs/API_RESPONSE_MIGRATION.md` | What changed for the frontends and what they may update |
| `docs/GLOSSARY.md` | Business words (lead, invoice, credit note, settlement ...) |
| `docs/quality/REPORT.md` | What the clean-up changed, how it was checked, open decisions |

## How a request flows

`src/app.js` (request id, helmet, JSON parsing, CORS, rate limits, IP analytics)
-> `src/routes/<area>.routes.js` (auth / permission middleware)
-> `src/controllers/<area>/<area>.controller.js` (thin, wrapped in `asyncHandler`)
-> `src/services/<area>/*.service.js` (business rules; throws `AppError`)
-> `src/models/*.model.js`.
Errors from any layer end in `src/middlewares/error.middleware.js`, which sends the one error format.

## Folder map

| Folder | What lives there |
|---|---|
| `src/app.js` | Entry point: middleware order, route mounting, startup and graceful shutdown |
| `src/config/` | Environment check (`env.config.js`), CORS, security, DB, Redis, S3, Razorpay, Zoho, Passport, Socket.IO |
| `src/constants/` | `HTTP_STATUS` and `ERROR_CODES` |
| `src/routes/` | URL -> middleware -> controller, one file per area |
| `src/controllers/<area>/` | HTTP handlers and Joi validators |
| `src/services/<area>/` | Business logic, database and external calls |
| `src/models/` | Mongoose schemas |
| `src/middlewares/` | Auth, permission, role, upload, validation, request id, IP analytics, errors |
| `src/helpers/` | `AppError` classes, `asyncHandler`, response helper, logger, cron helper, small utilities |
| `src/jobs/` | Daily jobs: best-seller labels, auto absent, coupon expiry (employee cleanup: opt-in) |
| `src/templates/email/` | HTML e-mail templates |
| `scripts/` | Endpoint list generator, one-off data migrations |
| `tests/` | `node --test` unit and contract tests |

## API areas

| Mounted at | Route file | Endpoints |
|---|---|---|
| `/api/webhook` | `routes/razorpaywebhook.routes.js` | 1 |
| `/oauth` | `routes/zohoauth.routes.js` | 1 |
| `/api` | `routes/zoho.routes.js` | 1 |
| `/api/v1/user` | `routes/users.routes.js` | 18 |
| `/api/v1/user/address` | `routes/addresses.routes.js` | 7 |
| `/api/v1/brand` | `routes/brands.routes.js` | 5 |
| `/api/v1/employee` | `routes/employees.routes.js` | 14 |
| `/api/v1/category` | `routes/categories.routes.js` | 4 |
| `/api/v1/contact` | `routes/contacts.routes.js` | 3 |
| `/api/v1/coupons` | `routes/coupons.routes.js` | 5 |
| `/api/v1/banner` | `routes/banners.routes.js` | 7 |
| `/api/v1/cart` | `routes/carts.routes.js` | 5 |
| `/api/v1/ipAnalytics` | `routes/ipanalytics.routes.js` | 3 |
| `/api/v1/video` | `routes/videos.routes.js` | 4 |
| `/api/v1/rating` | `routes/reviews.routes.js` | 5 |
| `/api/v1/product` | `routes/products.routes.js` | 8 |
| `/api/v1/stock-audit` | `routes/stockauditlogs.routes.js` | 1 |
| `/api/v1/permission` | `routes/permissions.routes.js` | 6 |
| `/api/v1/order` | `routes/orders.routes.js` | 17 |
| `/api/v1/librarylog` | `routes/librarylogs.routes.js` | 11 |
| `/api/v1/aws` | `routes/aws.routes.js` | 1 |
| `/api/v1/attendance` | `routes/attendance.routes.js` | 16 |
| `/api/v1/career` | `routes/careers.routes.js` | 16 |
| `/api/v1/blog` | `routes/blogs.routes.js` | 10 |
| `/api/v1/invoice` | `routes/invoices.routes.js` | 16 |
| `/api/v1/product-review` | `routes/productreviews.routes.js` | 5 |
| `/api/v1/notification` | `routes/notifications.routes.js` | 7 |
| `/api/v1/leads` | `routes/leads.routes.js` | 30 |
| `/api/v1/manual-order` | `routes/manualorders.routes.js` | 10 |
| `/api/v1/credit-note` | `routes/creditnotes.routes.js` | 9 |
| `/api/v1/testimonial` | `routes/testimonials.routes.js` | 5 |

## Attendance, leave, payroll and employee information

All rules live on the server. The frontend only shows what these endpoints return.

### Time

- Punch-in and punch-out use the **server clock**. Anything the client sends with a normal punch is ignored.
- Instants are stored in **real UTC**. The day an attendance record belongs to is the **IST date** (`Asia/Kolkata`, `YYYY-MM-DD`). See `src/helpers/istdate.helper.js`.
- Only a punch-out **correction request** may carry a client time: `{ date, time: "HH:mm" IST, reason }`.

### Rules

The rules are in one settings document (`PUT /api/v1/payroll/settings`); defaults are in `src/constants/payrollsettings.constant.js`.

| Setting | Default | Meaning |
|---|---|---|
| `weeklyOffDays` | `[0]` | Sunday is off. Holidays come from the Holiday collection. |
| `standardShiftMinutes` | 480 | Monday to Friday: 8 hours. Also the base for `perHour = perDay / 8`. |
| `saturdayShiftMinutes` | 360 | Saturday: 09:00-15:00 = 6 hours counts as a full day. |
| `fullDayGraceMinutes` | 10 | Worked >= expected - 10 min -> full day (7h50 on an 8h day, 5h50 on Saturday). |
| `halfDayThresholdPercent` | 50 | Below full but >= 50% of the day -> HALF_DAY (0.5 deducted); below that -> ABSENT. |
| `extraMinimumMinutes` | 30 | Time beyond the expected hours is EXTRA only from 30 min. All time on Sundays / holidays is extra. |
| `extraPayMultiplier` | 1 | extraPay = extra hours x perHour x multiplier. |
| `extraRequiresApproval` | false | When true, extra is shown but paid only after `PATCH /payroll/extra/:attendanceId`. |
| `paidLeaveQuotaPerMonth` | 1 | Paid days per month, shared by SICK + CASUAL, no carry-forward. UNPAID is never paid. |
| `leaveBackdateDays` / `leaveMaxFutureDays` | 7 / 180 | How far back a leave may start / how far ahead it may end. |
| `punchOutCorrectionWindowDays` | 7 | How far back a forgotten punch-out may be corrected. |
| `lateAfterTime` | 09:30 | LATE flag only (no deduction). |
| `allowPunchOnOffDays` | true | Allow punching on Sundays / holidays. |

The formulas, with worked examples, are in `src/services/payroll/payrollcalculator.js`. Unit tests are in `tests/payrollcalculator.test.js`.

- `workingDays` = days in the month - Sundays - holidays. `perDay` = base / workingDays.
- Each day is classified by `services/attendance/attendancerules.js#evaluateDay`. The calendar and the payroll both use it.
- Deductions:
  - Unpaid leave at perDay (0.5 for a half day).
  - ABSENT days at perDay.
  - HALF_DAY days at 0.5 x perDay.
  - Days before the joining date at perDay.
- A half-day leave makes the other half a 4h (Saturday 3h) working half.
- Days with an unresolved missing punch-out, or a pending leave, are **pending**. They are not deducted, and finalizing is refused while they exist unless `force: true`.
- net = base - deductions + extraPay, never below 0. Money is integer paise (BigInt), rounded half up once per category.

### New endpoints (all under `/api/v1`)

Admin routes check a permission fixed on the server (`requirePermission`).

| Method + path | Who | What |
|---|---|---|
| `GET attendance/today` | employee | Punch card: state, expected minutes, worked so far, days missing a punch-out |
| `GET attendance/my-calendar?month&year` | employee | Day-by-day calendar (holidays, Sundays, leave AM/PM, status, extra) |
| `GET attendance/my-punchout-requests` | employee | Own correction requests |
| `POST attendance/punch-out/request` | employee | `{ date, time, reason }` (old `{ requestedPunchOut }` still accepted) |
| `GET attendance/leave-balance?month&year` | employee | Paid quota, used, remaining, pending |
| `GET attendance/leave-request/:approvalId` | owner / admin | One leave request |
| `POST attendance/leave-request/:approvalId/cancel` | employee | Cancel own pending leave (the old `DELETE` still works; the request is now kept as `CANCELLED`) |
| `PATCH attendance/admin/leave-requests/:approvalId/paid` | `payroll.salary.update` | Override paid / unpaid `{ isPaid \| days, note }` (audited) |
| `GET attendance/admin/team-leaves?month&year&includePending` | `attendance.team.read` | Team leave calendar |
| `GET attendance/admin/holidays?year` | `attendance.holiday.manage` | Holiday list |
| `PUT / DELETE attendance/admin/holiday/:holidayId` | `attendance.holiday.manage` | Edit / delete a holiday (`POST attendance/admin/holiday` still creates one) |
| `GET payroll?month&year&search&page&limit` | `payroll.salary.read` | One row per employee, plus `month` (state) and `summary` |
| `GET payroll/employee/:employeeId?month&year` | `payroll.salary.read` | Day-by-day breakdown |
| `GET payroll/my-salary?month&year` | employee | Own breakdown only |
| `GET payroll/months?year` | `payroll.salary.read` | Finalize state per month |
| `POST payroll/finalize` `{ month, year, force? }` | `payroll.month.finalize` | Immutable snapshot, locks the month |
| `POST payroll/reopen` `{ month, year, reason }` | `payroll.month.finalize` | Unlock (audited); old snapshots kept |
| `GET / PUT payroll/settings` | read: `payroll.salary.read`; write: `payroll.settings.update` | The rules above |
| `GET / PUT payroll/salary-profile/:employeeId` | read / `payroll.salary.update` | Base salary + revision history `{ baseSalary, effectiveFrom, note }` |
| `PATCH payroll/extra/:attendanceId` `{ approved }` | `payroll.salary.update` | Approve extra time |
| `GET / PUT employee-profile/me` | employee | Own profile; may change only phone, addresses, emergency contact |
| `GET / POST employee-profile/me/documents` | employee | Own documents (multipart `file`, `documentType`, `expiryDate?`) |
| `GET employee-profile/:employeeId?reveal=true` | `employee.profile.read` (+ `employee.sensitive.read` to reveal, audited) | Profile; bank / PAN / Aadhaar / UAN masked by default |
| `PUT employee-profile/:employeeId` | `employee.profile.update` | `{ account?, personal?, employment?, bank? }` |
| `GET / POST employee-profile/:employeeId/documents` | `employee.document.read` / `employee.profile.update` | Documents of an employee |
| `GET employee-profile/documents/:documentId/download` | owner or `employee.document.read` | 5-minute signed link (audited) |
| `PATCH employee-profile/documents/:documentId/verify` | `employee.document.verify` | `{ status: VERIFIED \| REJECTED, rejectionReason }` |
| `DELETE employee-profile/documents/:documentId` | owner (not verified) or `employee.document.verify` | Soft delete + file removed |

Existing attendance paths and methods are unchanged. Their lists are now paginated: `data` is still the array, and `meta` is added. `my-attendance` returns the same record keys as before (`dayType`, `status[]`, `totalWorkedTime`) plus `workedMinutes`, `expectedMinutes`, `extraMinutes` and `attendanceStatus`.

### Storage

| Collection | What |
|---|---|
| `attendance_days` | One document per employee per IST date. A unique `(employee, date)` index blocks double punch-in. |
| `holidays` | One per date (unique). |
| `adminapprovals` | Leave and punch-out requests (extended). A partial unique index allows one pending correction per day. |
| `payroll_settings`, `salary_profiles`, `payroll_months`, `payroll_snapshots` | Payroll. |
| `employee_profiles`, `employee_documents` | Employee information. Sensitive fields use AES-256-GCM. Files are in private S3 under random keys; only metadata is in MongoDB. |
| `employeerecords` | The OLD per-employee attendance arrays: read-only backup, no longer written. |

Audit entries (salary changes, bank changes, sensitive reveals, document downloads / verifications, paid overrides, finalize / re-open, settings changes) go to the existing `PermissionAudit` feed with a `details` field.

A job runs daily at 23:55 IST (`src/jobs/endofday.job.js`). It marks open sessions `MISSING_PUNCH_OUT` and notifies the employee. It replaces the old 19:00 auto-absent job: absence is now a rule, not a stored record.

### Deploying (in this order)

1. Set `FIELD_ENCRYPTION_KEY` (32 random bytes, base64; see `.env.example`) and make sure the S3 bucket blocks public access.
2. Deploy the backend **and** the frontend together. The frontend no longer adds +5:30 to times.
3. `node scripts/seedhrpermissions.js` (dry run), then add `--apply`. This creates the new permissions and gives them to Super Admin / Admin.
4. `node scripts/migrateattendancedays.js` (dry run). Check the printed samples: an old stored `09:30Z` must become `04:00Z` = 09:30 IST. Then add `--apply`.
   - Re-running is safe: it only inserts missing days and fills empty fields.
   - Options: `--shift-minutes=330` (default) and `--recompute` (refresh cached minutes after a settings change).
5. Give HR users the permissions they need on the Permissions screen. Set salary profiles before finalizing the first month.

### Tests

`npm test` runs:
- `tests/payrollcalculator.test.js`: the worked examples (24,125 / 1,000 / 500), Saturday, extra and rounding.
- `tests/attendancerules.test.js`: punch rules, leave day counting and quota.
- `tests/istdate.test.js`
- `tests/security.test.js`: encryption and real file-type checks.
- `tests/hrpermissions.test.js`: 403 without the permission on every new admin route, and validation.
