# Clean-up report: Digident Backend

This report covers three things: what was changed so a new developer can understand and safely change this API, how the changes were checked, and what still needs a decision.

**Base:** the latest GitHub `main` (commit `22231ec`, 2026-10-13), moved into the standard folder layout (same files, new places, imports rewritten). Nothing from GitHub is lost: every change made there up to 13 Oct (agent performance, fuzzy search, credit notes, invoice / manual order / lead updates) is in this code.

## What changed

1. **One error system.**
   - Added the `AppError` classes (`helpers/apperror.helper.js`) and `asyncHandler`.
   - Added one global error handler and a 404 handler, mounted last (`middlewares/error.middleware.js`).
   - Controllers no longer contain `try/catch`. Services throw `NotFoundError`, `ConflictError` and similar classes, each with a code from `ERROR_CODES`.
   - Removed the old `handleError`, `sendError`, `ok()`, `ApiResponse` and the testimonial `respondError`. Razorpay SDK errors still come back as 400 with Razorpay's own description, as before.
2. **One success format.** All success responses go through `sendSuccess`, `sendCreated` or `sendPaginated`.
   - Endpoints that used to put keys at the top level still send those keys. See `docs/API_RESPONSE_MIGRATION.md`.
3. **Correct status codes.** The old handler turned almost every error into a 500.
   - Business errors now return 400, 401, 403, 404 or 409, as their authors intended. For example, "Order not found" now returns 404.
   - The six error codes the frontends already know keep the same status and message.
4. **Logging.** The 338 `console.*` calls were replaced by a small JSON logger.
   - The logger adds the request id and masks secrets.
   - Every response carries an `x-request-id` header, and every error body has a `requestId`.
5. **Startup and shutdown.**
   - `.env` is loaded once and checked with Joi (`config/env.config.js`).
   - The server exits if MongoDB, Redis or the environment check fails.
   - `SIGTERM`, `SIGINT`, unhandled rejections and uncaught exceptions all lead to a graceful shutdown.
6. **Security.**
   - Added helmet.
   - Added rate limits: 20 attempts per 15 minutes on the login, OTP and password routes, and 3,000 requests per 15 minutes on `/api`.
   - CORS origins now live in `config/cors.config.js`. Duplicates were removed, and `CLIENT_URL` and `CORS_ORIGINS` are added from the environment.
   - The Zoho OAuth route no longer writes tokens to the logs.
7. **IP analytics moved off the request path.** The ip-api.com lookup used to delay every request by up to 1.5 s.
   - It now runs after the response is sent.
   - Results are cached in Redis for 7 days per IP. The same fields are stored as before.
8. **Cron jobs** now use `scheduleJob()`. Each run is logged. A job never overlaps with itself, cannot crash the process, and is stopped on shutdown.
9. **External calls.**
   - Zoho calls have a 10 s timeout.
   - Zoho and S3 failures become `ExternalServiceError` (502), with the original error kept as `cause`.
   - The Razorpay webhook checks the signature before it opens a transaction, and it always ends its session.
10. **Big files split by sub-domain.** The original files re-export everything, so no import had to change. About 9,800 lines of commented-out old code (old copies of whole files) were removed as well.

    | Original file | New files added |
    |---|---|
    | `order.service.js` | `orderreturn`, `orderrefund`, `orderdashboard` |
    | `attendance.service.js` | `leave`, `punchoutrequest`, `holiday` |
    | `attendance.controller.js` | the matching controller files |

11. **Readable code.**
    - Every file has a header: what it is for, its route and who uses it.
    - 239 exported functions have JSDoc: parameters, return value and the AppErrors each one throws.
    - All comments are in English.
    - 220 lines of commented-out code were removed.
    - Dead files were fixed or removed, and unused imports were removed.
12. **Tooling.**
    - Added ESLint (flat config), Prettier and EditorConfig.
    - Added the npm scripts `lint`, `format`, `test` and `endpoints`.
    - Cleaned up `package.json`:
      - removed the fake packages `from`, `import`, `fs`, `http`, `os` and `crypto`;
      - kept only `bcryptjs`;
      - moved `nodemon` to devDependencies;
      - added `engines`, `helmet`, `express-rate-limit`, `eslint`, `prettier` and `supertest`.

## Bugs found and fixed

ESLint's `no-undef` rule found names that did not exist when the code ran. All of these were already in the original code.

| Where | Before | Now |
|---|---|---|
| `getAllProductReviewsService` | `skip` was never defined, so the review list always failed | Computed from page and limit |
| `updateProductReviewService` | `changes` was never defined, so every review update failed | Changes are tracked |
| Product model pre-save hook | Called `next()`, which does not exist there | Throws a 400 |
| Attendance holiday notification | Used an `employee` variable that did not exist, so the notification was silently never sent | Sender set to null; the notification is sent |
| Duplicate-product notification | Used `product` instead of `newProduct` | Fixed |
| Permission notifications | Used `audit`, which was never stored | The audit record is stored |
| `ipanalytics.middleware.js` | Called `handleError`, which was not imported, so a failed analytics write failed the whole request | Analytics never affects the request |
| `multipartjson.middleware.js` | The error message was not a template string, so it never showed the field name | Shows the real field name |
| Product update | A Joi validation error was returned as a 500 | Returns 400 with field details |
| Job application | A failed confirmation e-mail deleted the uploaded resume of an application that was already saved | The e-mail failure is logged and the application is kept |

## How it was checked

The npm registry could not be reached from the build machine, so I could not run `npm install` or start the server against a real database. These checks were run instead:

- **Every module loads.** All 226 files were imported with stubbed packages. Every relative import and named export resolves.
- **ESLint has 0 errors.** Before the clean-up there were 463, including 19 undefined names. 688 warnings remain (magic numbers, short names, long functions) as follow-up work.
- **25 unit tests pass** (`npm test`). They cover:
  - how the error handler maps every error type;
  - hiding 500 messages in production;
  - the legacy error codes and Razorpay SDK errors;
  - the success shapes, including the old top-level keys;
  - pagination meta;
  - `asyncHandler`.
- **A contract test is written but has not been run yet** (`tests/contract.test.js`). It needs `npm install` first. It walks `docs/ENDPOINTS.md` and checks that:
  - every auth-protected route answers 401 in the error format;
  - unknown routes answer 404;
  - a bad JSON body answers 400.
- **The endpoints are unchanged.** All 252 endpoints of the GitHub code keep the same method, path and middleware chain. Only three inline handlers were given names:
  - `GET /oauth/redirect`
  - `GET /api/v1/leads/debug/unassigned-count`
  - `GET /api/v1/leads/debug/agents`

**Before you deploy:**

1. Run `npm install`, `npm test` and `npm run lint`.
2. Start the server with your `.env`.
3. In the four frontends, click through: login; order create, pay, cancel and return; the invoice screens; the attendance screens.

## Numbers

Before = GitHub `main` (22231ec). After = this code.

| | Before | After |
|---|---:|---:|
| Source files | 205 | 226 |
| Total lines (src) | 51,925 | 41,413 |
| `console.*` calls | 338 | 0 |
| `try` blocks in controllers | 290 | 24 (only allowed cases) |
| `handleError()` / `sendError()` calls | 263 / 283 | 0 / 0 |
| `ok(res, …)` calls | 52 | 0 |
| `throw new Error(...)` | 234 | 2 (startup only) |
| `throw { ... }` (no stack) | 97 | 0 |
| `throw new <AppError subclass>` | 0 | 690 |
| Hard-coded status numbers | 402 | 3 |
| ESLint errors | 463 | 0 |

## Decisions needed (not changed)

1. **The Razorpay webhook does not work today.** `express.json()` runs before the webhook route, so the raw body needed for the signature check is never available and every call fails.
   - The fix is to move the webhook above `express.json()` in `app.js`.
   - This **switches on real refund processing**: Razorpay events will start changing order payment statuses and refund amounts.
   - Confirm before moving that line.
2. **Some write endpoints have no login check.**
   - Examples:
     - `DELETE /api/v1/user/delete/:userId`
     - `DELETE /api/v1/librarylog/deleteById/:customerId`
     - `PUT` and `DELETE` routes under `/api/v1/testimonial/...` and `/api/v1/product-review/...`
     - `PATCH /api/v1/librarylog/scanbridge`
   - `GET /api/v1/aws/download-presigned-url` and several order list routes are also open.
   - Adding auth could break a frontend that calls these without a token, so decide per route.
3. **`POST /api/v1/leads/distribute`** has no admin check, and `req` is passed where an employee is expected.
4. **ip-api.com HTTPS**: the free plan supports HTTP only. HTTPS needs the paid plan or another provider. Which one should be used?
5. **`GET /api/v1/leads/debug/*`** was added "temporarily" and is open to every logged-in employee. Should it be removed?
6. **`jobs/employeecleanup.job.js`** was never started. It is now an opt-in function. Should it be started?
7. **Rate limits**: 20 and 3,000 per 15 minutes are starting values. Adjust them in `config/security.config.js`.

## Not done yet

- **Joi validators** for the 14 controllers that have none:
  - adminemail, attendance, blogview, creditnote, ipanalytics, lead, manualorder;
  - notification, order, paymentaudit, razorpaywebhook, stockauditlog, zoho, zohowebhook.

  `middlewares/validate.middleware.js` is ready. Unknown fields are stripped, so each schema must list every field its service reads, and each one has to be tested with its screen.
- **Transactions** for writes that touch several documents:
  - order create, cancel, return and refund, together with the stock updates;
  - coupon usage;
  - attendance approvals;
  - invoice and order sync.
- **Files still over 400 lines**:
  - `manualorder.service.js` (1,654 lines), `order.service.js` (1,204), `invoice.service.js`, `lead.service.js`, `creditnote.service.js`, `product.service.js`;
  - several controllers, mostly because of their doc comments.
- **688 lint warnings**, mostly unexplained numbers and short names inside services.
