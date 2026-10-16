# API response migration

What changed in the responses during the clean-up, and what the frontends should do.
Nothing was removed: every key a frontend read before is still sent.

**Removal flag:** the old top-level keys below are kept until the four frontends read `data`.
Remove them only after confirming with the team. Search the code for `legacyTopLevel`.

## 1. Success responses

| Endpoint | Old shape | New shape | Frontend change |
|---|---|---|---|
| Every endpoint that used `sendSuccess` | `{ success, message, statusCode, data }` | same | none |
| `GET /api/v1/leads` | `{ success, leads, total, page, totalPages }` | same keys **plus** `message`, `statusCode`, `data: { leads, total, page, totalPages }` | read `res.data.data.leads` (later) |
| `GET /api/v1/leads/upcoming` | `{ success, data, count }` | same keys plus `message`, `statusCode` | none |
| `GET /api/v1/leads/admin/by-agent/:employeeId` | `{ success, ...result }` | same keys plus `message`, `statusCode`, `data: result` | read `data` (later) |
| other `/api/v1/leads/*` | `{ success, data }` or `{ success, message }` | plus `message`, `statusCode` | none |
| `GET /api/v1/leads/debug/unassigned-count` | `{ unassignedCount, totalLeads }` (no `success`) | same keys plus `success`, `message`, `statusCode`, `data` | none |
| `GET /api/v1/leads/debug/agents` | `{ count, agents }` | same keys plus `success`, `message`, `statusCode`, `data` | none |
| `GET /api/v1/aws/download-presigned-url` | `{ success, downloadUrl }` | same keys plus `message`, `statusCode`, `data: { downloadUrl }` | read `data.downloadUrl` (later) |
| `GET /oauth/redirect` (Zoho setup) | `{ access_token, refresh_token, … }` | same keys plus `success`, `message`, `statusCode`, `data` | none |

## 2. Error responses (all endpoints)

| What | Before | Now | Frontend change |
|---|---|---|---|
| Shape | `{ success: false, message, statusCode, error: { code } }` (some endpoints: `{ success, message }` only, or plain text) | always `{ success: false, message, statusCode, error: { code, details? }, requestId }` | none: `success` and `message` are still there |
| Status of business errors | many came back as **500** (for example "Order not found", "Cart is empty", codes such as `ADDRESS_NOT_FOUND`) | the right status: 400 / 401 / 403 / 404 / 409 | if a screen checks `status === 500` for these, change it to check `error.code` |
| Message of code-only errors | the raw code, e.g. `"ADDRESS_NOT_FOUND"` | readable text, e.g. `"Address not found"`; the code is in `error.code` | show `message`; switch on `error.code` |
| Validation `details` | array of strings | array of `{ field, message }` | show `detail.message` |
| Unexpected 500 in production | the internal error message | `"Something went wrong"` + `requestId` | show the message; give the requestId to support |
| Blocked CORS origin | 500 "CORS Blocked" | 403 `CORS_BLOCKED` | none |
| Unknown route | Express HTML page | 404 JSON `ROUTE_NOT_FOUND` | none |
| Too many attempts | (no limit) | 429 `TOO_MANY_REQUESTS` on login / OTP / password routes after 20 tries in 15 minutes | show the message |

The six old error codes the frontends know (`EMAIL_EXISTS`, `INVALID_CREDENTIALS`, `USER_NOT_FOUND`,
`INVALID_OLD_PASSWORD`, `TOKEN_EXPIRED`, `INVALID_TOKEN`) keep exactly the same status and message.

## 3. Attendance / leave (HR upgrade, 2026-10)

| Endpoint | Before | Now | Frontend change |
|---|---|---|---|
| `POST attendance/punch-in`, `punch-out` | times IST-shifted (5h30 ahead), client `punchOutTime` ignored anyway | real UTC from the server clock; same keys plus `attendance` | show times with `timeZone: "Asia/Kolkata"`; drop the `.replace('Z','')` hack |
| `GET attendance/my-attendance` | whole records array incl. auto Sunday / holiday / leave entries | attendance days only (same keys) + `meta`; leave via `my-leave-requests`, holidays via `holidays`, calendar via `my-calendar` | use `my-calendar` for calendars |
| `GET attendance/admin/attendances` | nested `$__parent` documents | flat day records with `employee`, paginated | read `data[]` + `meta` |
| `GET attendance/holidays` | `{ date, reason }` from each employee's records | same keys from the Holiday collection, plus `title`, `type`, `_id` | none |
| `DELETE attendance/leave-request/:id` | deleted the request | status `CANCELLED`, kept | none |
| `GET attendance/admin/attendance-approvals/filter` | status in the body of a GET | `?status=` (POST with body also accepted) | send a query param |
| Errors `ALREADY_PUNCHED_IN`, `ALREADY_PUNCHED_OUT`, `ALREADY_PROCESSED` | 400 | 409 (same codes) | switch on `error.code` |
| `POST employee/create` | returned the password hash | password hash and tokens removed | none |
