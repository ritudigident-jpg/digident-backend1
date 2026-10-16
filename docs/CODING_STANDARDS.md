# Digident Backend Coding Standard

**Version 1.0, 2026-10-16.** Applies to the Digident API (Express 5, Mongoose, ES modules).
The frontend repos have their own standard with the same spirit; business words are in `GLOSSARY.md`.

## The goal

> Any developer who opens any file can answer within 5 minutes:
> **What does this file do? Which route reaches it? What can go wrong, and what does the client get then?**

When a rule makes code longer but clearer, choose clearer. When unsure, ask:
*"Would a new developer understand this without asking me?"*

---

## Start here: where is what

| I want to ... | Go to |
|---|---|
| See every URL, method and middleware | `docs/ENDPOINTS.md` (`npm run endpoints` regenerates it) |
| Know the response / error format | `docs/API_CONVENTIONS.md` |
| Add or change a route | `src/routes/<area>.routes.js` (mounted in `src/app.js`) |
| Handle a request | `src/controllers/<area>/<area>.controller.js` |
| Change a business rule | `src/services/<area>/<area>.service.js` (bigger areas are split: `orderreturn.service.js`, `leave.service.js` ...) |
| Change a database shape | `src/models/<name>.model.js` |
| Validate a request body | `src/controllers/<area>/<area>.validator.js` (Joi) |
| Add an error code | `src/constants/errorcodes.constant.js` |
| Add an environment variable | `src/config/env.config.js` **and** `.env.example` |
| Allow a new website origin | `src/config/cors.config.js` |
| Add a scheduled job | `src/jobs/` with `scheduleJob()` from `helpers/cronjob.helper.js` |
| Send an e-mail | `services/zoho/zohomail.service.js` + a template in `src/templates/email/` |

**One request, in order:** `app.js` (request id, security, parsing, CORS, rate limit) -> route file
(auth / permission middleware, validation) -> controller (read request, call service, send response)
-> service (rules, database, external calls) -> model. Any thrown error goes to
`middlewares/error.middleware.js`, which sends the one error format.

**Every file starts with a header** saying what it is for, its route(s) and who uses it. Read it first.

---

## Cheat sheet

| # | Rule | Section |
|---|---|---|
| 1 | Controllers are thin: read the request, call a service, send the response. No business logic, no `try/catch`. | 2 |
| 2 | Every controller is wrapped in `asyncHandler`. | 3 |
| 3 | Services throw `AppError` subclasses (`NotFoundError`, `ConflictError` ...). Never `throw new Error("CODE")`, never `throw { ... }`. | 3 |
| 4 | `try/catch` only for: transactions, external calls, best-effort side effects, cleanup. Never empty, never just re-throw. | 3 |
| 5 | Success responses only through `sendSuccess` / `sendCreated` / `sendPaginated`. Never `res.json(...)` by hand. | 4 |
| 6 | Validate input with Joi before it reaches a service. | 5 |
| 7 | No `console.*`. Use `logger` and pass the error as `{ error }`. Never log tokens, passwords, OTPs. | 6 |
| 8 | No hard-coded numbers or strings that mean something: use `HTTP_STATUS`, `ERROR_CODES` or a named constant. | 7 |
| 9 | Multi-document writes that must succeed together use a transaction. | 8 |
| 10 | External calls (Razorpay, Zoho, S3) have a timeout and wrap failures in `ExternalServiceError` with `cause`. | 8 |
| 11 | Cron jobs use `scheduleJob()`; webhooks verify the signature first and are idempotent. | 9 |
| 12 | Environment variables are declared and checked in `config/env.config.js`. | 10 |
| 13 | Full English names; JSDoc on every exported service function (purpose, params, returns, throws). English comments only. | 11 |
| 14 | No commented-out code, no dead routes, no "temporary" debug endpoints left in. | 11 |
| 15 | `npm run lint`, `npm run format`, `npm test` pass; `docs/ENDPOINTS.md` diff reviewed. | 12 |

---

## 1. Naming

- Full English words: `employee`, `invoice`, `approvalId`. One-letter names only for `i` in a `for` loop.
- Services end in `Service` (`createOrderService`), controllers are verbs (`createOrder`), validators end in
  `Validator` or `Schema`, booleans start with `is/has/can`.
- Constants are `SCREAMING_SNAKE_CASE` and say their unit: `SHUTDOWN_TIMEOUT_MS`, `GEO_CACHE_SECONDS`.
- Spell-check names. A typo in a variable is a bug waiting to happen:

```js
// BAD  (order.service.js, before) - "premission" was never defined, so every status update crashed
//       with a ReferenceError after the order had already been saved.
permission: premission || "update_order_status",

// GOOD
permission: data.permission || "update_order_status",
```

## 2. Layers: routes, controllers, services, models

- **Route files** only map URL + middleware to a controller. No inline handlers, no database calls.
- **Controllers**: about 15 lines per handler. Parse the request, call one service, send the response.
  Never pass `res` into a service.
- **Services** hold every rule and every database / external call. They know nothing about HTTP except
  which `AppError` to throw.
- **Models** define the schema. Hooks may validate, but throw `AppError`s.

```js
// BAD  (routes/leads.routes.js, before) - logic and a DB query inside the route file
router.get("/debug/agents", auth, async (req, res) => {
  const Employee = (await import("../models/employee.model.js")).default;
  const agents = await Employee.find({ role: 4, isDeleted: false });
  res.json({ count: agents.length, agents });
});

// GOOD
router.get("/debug/agents", auth, lc.getActiveAgentsDebug);          // route file
export const getActiveAgentsDebug = asyncHandler(async (req, res) => {   // controller
  const agents = await svc.getActiveAgentsDebug();                      // service does the query
  sendSuccess(res, { data: agents });
});
```

A file over 400 lines is split by sub-domain, and the original file re-exports the moved functions so no
import changes (see `services/order/order.service.js` -> `orderreturn.service.js`, `orderrefund.service.js`).

## 3. Errors and try/catch (the most important section)

### 3.1 Controllers have no try/catch

```js
// BAD  (brand.controller.js, before) - the same try/catch copied into 216 handlers
export const createBrand = async (req, res) => {
  try {
    ...
    return sendSuccess(res, result, 201, "Brand created successfully");
  } catch (error) {
    console.error("Create Brand Error:", error);
    return handleError(res, error);
  }
};

// GOOD - one try/catch for the whole app lives in asyncHandler
export const createBrand = asyncHandler(async (req, res) => {
  ...
  return sendCreated(res, { data: result, message: "Brand created successfully" });
});
```

### 3.2 Services throw AppError subclasses

| Class | Status | Use for |
|---|---|---|
| `BadRequestError` / `ValidationError` | 400 | bad input, a rule is broken |
| `UnauthorizedError` | 401 | not logged in, bad token or password |
| `ForbiddenError` | 403 | not allowed |
| `NotFoundError` | 404 | record does not exist |
| `ConflictError` | 409 | already exists / already processed |
| `ExternalServiceError` | 502 | Razorpay, Zoho, S3 failed |
| `AppError` | 500 | anything unexpected |

```js
// BAD  (employee.service.js, before) - the old handler ignored statusCode, so the client got 500
//       with the message "EMPLOYEE_ALREADY_EXISTS"
const err = new Error("EMPLOYEE_ALREADY_EXISTS");
err.statusCode = 400;
throw err;

// BAD  (attendance.service.js, before) - a plain object has no stack trace
throw { message: "Employee not found", statusCode: 404, errorCode: "EMPLOYEE_NOT_FOUND" };

// GOOD
throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
```

### 3.3 When try/catch IS allowed (only these four)

1. **Transactions**: start, commit, abort in `catch`, end in `finally`.

```js
// GOOD  (razorpaywebhook.controller.js)
const session = await mongoose.startSession();
try {
  session.startTransaction();
  const message = await applyRefundEventService({ event, refund, session });
  await session.commitTransaction();
  return sendSuccess(res, { data: {}, message });
} catch (error) {
  if (session.inTransaction()) await session.abortTransaction();
  throw error;
} finally {
  await session.endSession();
}
```

2. **External calls**: set a timeout, wrap the failure, keep the cause.

```js
// GOOD  (zoho.controller.js)
try {
  const response = await axios.get(url, { headers, timeout: ZOHO_TIMEOUT_MS });
  data = response.data;
} catch (error) {
  throw new ExternalServiceError("Zoho API error", { code: ERROR_CODES.ZOHO_API_ERROR, cause: error });
}
```

3. **Best-effort side effects** (e-mail, notification, audit log, socket emit) that must not fail the main
   request: catch, log with context, continue.

```js
// BAD  (jobapplication.controller.js, before) - a failed confirmation mail deleted the uploaded resume
//       of an application that had already been saved, and answered 500
await sendZohoMail(value.email, "Application Submitted Successfully", htmlBody);

// GOOD
try {
  await sendZohoMail(value.email, "Application Submitted Successfully", htmlBody);
} catch (mailError) {
  logger.error("Application confirmation mail failed", { applicationId: application.applicationId, error: mailError });
}
```

4. **Cleanup**: undo work when a later step fails (delete an uploaded S3 file), in `catch` + re-throw or `finally`.

**Never:**

```js
catch (error) {}                              // swallowed: nobody will ever know
catch (error) { throw error; }                // adds nothing - remove the try
catch (error) { throw new Error(error.message || "Failed"); }   // loses the status and the stack
catch { return null; }                        // only with a comment saying why null is correct
```

### 3.4 Middlewares

Middlewares throw (or call `next(error)`) too. Never send an error response by hand from a middleware.

```js
// BAD  (multipartjson.middleware.js, before) - also a bug: "${field}" in double quotes is not a template
return res.status(400).json({ success: false, message: "Invalid JSON format in field: ${field}" });

// GOOD
return next(new BadRequestError(`Invalid JSON format in field: ${field}`, { code: ERROR_CODES.INVALID_JSON, cause: error }));
```

## 4. Responses

Only the response helper sends success responses. See `docs/API_CONVENTIONS.md` for the contract.

```js
sendSuccess(res, { data: order, message: "Order fetched" });        // 200
sendCreated(res, { data: { productId }, message: "Product added" }); // 201
sendPaginated(res, { data: items, pagination: { page, limit, total } });
```

Changing a response shape breaks four frontends. If you must, keep the old keys with `legacyTopLevel`
and add a row to `docs/API_RESPONSE_MIGRATION.md`.

## 5. Validation

- Every body, query and param of a mutating endpoint is validated with Joi before the service runs:
  `router.post("/", validate(createBrandSchema), createBrand)` or, inside the controller,
  `if (error) throw ValidationError.fromJoi(error);`.
- Ids in the URL that are Mongo ObjectIds: `validateObjectIdParams("orderId")`.
- `stripUnknown: true` removes fields that are not in the schema, so the schema must list every field the
  service uses. Add the schema, then test the screen that calls it.

## 6. Logging

```js
// BAD  (zohoauth.routes.js, before) - printed the Zoho refresh token into the server logs
console.log("Zoho Token Response:", data);

// GOOD
logger.info("Zoho tokens issued", { requestId: req.id });
logger.error("Order create failed", { requestId: req.id, orderId, error });
```

- Levels: `debug` (details, hidden in production), `info` (normal events), `warn` (odd but handled),
  `error` (a failure). Pass the error object as `error` so the stack is kept.
- Include `requestId: req.id` when you have a request.
- Never log passwords, tokens, OTPs, card data or full personal data. The logger masks keys named like
  `password`, `token`, `secret`, `otp`, but do not rely on it.

## 7. Constants

```js
// BAD   setTimeout(..., 10000);  cron.schedule("0 0 19 * * *", ...)   res.status(404)
// GOOD  const SHUTDOWN_TIMEOUT_MS = 10_000;   // 7 PM IST daily: mark absent   throw new NotFoundError(...)
```

- HTTP statuses: `HTTP_STATUS`. Error codes: `ERROR_CODES` (never rename a code; clients rely on it).
- Roles are numbers in the database: compare with a named constant (`ROLES.ADMIN`), not `role === 1`.

## 8. Data integrity and external services

- Writes to more than one document that must all succeed (order + stock, refund + invoice, credit note +
  invoice, attendance approval + record) run in a transaction, or use a single conditional update
  (`updateOne({ _id, stock: { $gte: qty } }, { $inc: { stock: -qty } })`).
- Every external call has a timeout (Zoho 10 s, geo lookup 1.5 s) and is wrapped in `ExternalServiceError`.
- Keep slow, optional work off the request path. Example: the IP geo lookup now runs after the response
  is sent and is cached in Redis for a week (`services/ipanalytics/iptracking.service.js`).

## 9. Jobs and webhooks

```js
// BAD  (couponexpiry.job.js, before) - its own try/catch, can run twice at once
cron.schedule("0 0 * * *", async () => { try { ... } catch (error) { console.error(...) } });

// GOOD - logged, never overlaps, never crashes the process, stopped on shutdown
scheduleJob("coupon-expiry", "0 0 * * *", async () => { ... });
```

Webhooks: verify the signature **before** anything else, make processing idempotent (store and check the
event / refund id), answer quickly.

## 10. Configuration and startup

- `.env` is loaded once, by `src/config/env.config.js`, which is the first import of `app.js`.
  Never call `dotenv.config()` anywhere else.
- A new variable goes into the Joi schema in `env.config.js` (required or optional) and into `.env.example`.
- If startup fails (database, Redis, bad env) the server logs the reason and exits with code 1, so the host
  restarts it instead of running half-broken.

## 11. Comments and documentation

- Every file starts with a header: what it is for, route(s), who uses it.
- Every exported service function has JSDoc: purpose, `@param`, `@returns`, `@throws` for each AppError.
- Every money rule has a worked example in its comment:

```js
// refund.processed: adds the refund amount; "refunded" when total refunds reach the grand total.
// Example: grand total 1,000, refund of 400 processed -> refundAmount 400, "partially_refunded".
```

- Comments explain **why**, in English, without emojis.

```js
// BAD   // routes mein add karo temporarily        (leads.routes.js, before)
// BAD   // ✅ initialize socket correctly
// GOOD  // TODO(team, 2026-11-01): remove these debug endpoints once they are no longer needed.
```

- No commented-out code (git keeps the history). TODOs have an owner and a date.

## 12. Tools, tests and review

| Command | What it does |
|---|---|
| `npm run dev` | Start with auto-reload |
| `npm run lint` | ESLint (`eslint.config.js`). Errors must be 0. |
| `npm run format` | Prettier |
| `npm test` | Unit tests + API contract test (`tests/`) |
| `npm run endpoints` | Regenerate `docs/ENDPOINTS.md`; review the diff in every PR |

- A refactor PR never changes a URL, method, middleware chain or schema; `docs/ENDPOINTS.md` must show no
  change in those columns.
- Add a test for every business rule you change (start with money: order totals, refunds, coupons).
- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`.

### Review checklist

- [ ] Controllers thin, wrapped in `asyncHandler`, no `try/catch`.
- [ ] Services throw `AppError` subclasses with an `ERROR_CODES` code.
- [ ] Every `try/catch` is one of the four allowed cases; nothing swallowed.
- [ ] Responses only through the response helper; shape changes documented.
- [ ] Input validated; ObjectId params checked.
- [ ] No `console.*`, no secrets in logs, no magic numbers.
- [ ] Multi-document writes atomic; external calls have timeouts.
- [ ] Header, JSDoc and worked examples present; English only; no commented-out code.
- [ ] `npm run lint` (0 errors), `npm test`, `npm run endpoints` (diff reviewed).
