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
