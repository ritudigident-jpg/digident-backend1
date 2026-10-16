# API conventions

How every endpoint of this API answers. Four frontends depend on this, so treat it as a contract.
The code that enforces it: `src/helpers/response.helper.js` (success), `src/middlewares/error.middleware.js`
(errors), `src/helpers/apperror.helper.js` (error classes), `src/constants/` (status and error codes).

## Success

```json
{
  "success": true,
  "message": "Brand fetched",
  "statusCode": 200,
  "data": { "brandId": "…" },
  "meta": { "page": 1, "limit": 10, "total": 35, "totalPages": 4, "hasNext": true, "hasPrev": false }
}
```

- `data` is an object, an array or `null`. It is always present.
- `meta` only on paginated lists (`sendPaginated`, `buildPaginationMeta`).
- `statusCode` repeats the HTTP status (older clients read it).
- 200 for reads and updates, 201 for creates. 204 is never used (clients always parse JSON).
- Some older endpoints also keep their old top-level keys next to `data`; see
  [API_RESPONSE_MIGRATION.md](API_RESPONSE_MIGRATION.md).
- Dates are ISO-8601 UTC strings (`2026-10-16T04:00:00.000Z`).

## Error

```json
{
  "success": false,
  "message": "Validation failed",
  "statusCode": 400,
  "error": {
    "code": "VALIDATION_ERROR",
    "details": [{ "field": "email", "message": "\"email\" is required" }]
  },
  "requestId": "4f1c2a9e-…"
}
```

- `error.code` is a stable string from `src/constants/errorcodes.constant.js`. Clients may switch on it.
- `error.details` only when useful (validation, duplicate fields).
- `requestId` is also sent as the `x-request-id` response header. Every log line of that request carries it:
  search the logs for it when a user reports a problem.
- In production a 500 always says `"Something went wrong"`; the real error is only in the logs.
  In development the message and `error.stack` are included.

## Status codes

| Status | When | Thrown with |
|---|---|---|
| 400 | Bad input, a business rule is broken, invalid id, invalid JSON, Razorpay rejected the request | `BadRequestError`, `ValidationError` |
| 401 | Not logged in, token missing / expired / invalid, wrong password | `UnauthorizedError` |
| 403 | Logged in but not allowed (role, permission, office IP, CORS) | `ForbiddenError` |
| 404 | Record not found, unknown route | `NotFoundError` |
| 409 | Already exists, duplicate, already processed | `ConflictError` |
| 429 | Too many requests (see rate limits) | `TooManyRequestsError` |
| 500 | Unexpected failure (a bug) | `AppError` / anything not classified |
| 502 / 504 | Razorpay, Zoho, S3 … failed / timed out | `ExternalServiceError` |

## Rate limits

- All `/api` routes: 3,000 requests per IP per 15 minutes.
- Login, register, OTP and password-reset routes: 20 attempts per IP per 15 minutes.
- Over the limit: 429 `TOO_MANY_REQUESTS`. Settings: `src/config/security.config.js`.

## Error codes

Status shown is the one the code is currently thrown with ("-" = not thrown directly).

| Code | Status |
|---|---|
| `ADDRESS_ALREADY_EXISTS` | 409 |
| `ADDRESS_ID_REQUIRED` | 400 |
| `ADDRESS_NOT_FOUND` | 400,404 |
| `ADDRESS_REQUIRED` | 400 |
| `ADD_TO_CART_FAILED` | 500 |
| `ADMIN_NOT_FOUND` | 403 |
| `ADMIN_ROLE_REQUIRED` | 403 |
| `ALREADY_PENDING_APPROVAL` | 400 |
| `ALREADY_PROCESSED` | 400,409 |
| `ALREADY_PUNCHED_IN` | 400,409 |
| `ALREADY_PUNCHED_OUT` | 400,409 |
| `ALREADY_REQUESTED` | - |
| `ANONYMOUS_REVIEW` | 403 |
| `APPLICATION_ID_REQUIRED` | 400 |
| `APPLICATION_NOT_FOUND` | 404 |
| `APPROVAL_NOT_FOUND` | 404 |
| `ATTENDANCE_EXISTS` | 400 |
| `AUTH_HEADER_MISSING` | 401 |
| `BAD_REQUEST` | 400 |
| `BILLING_ADDRESS_REQUIRED` | 400 |
| `BLOG_ALREADY_EXISTS` | 409 |
| `BLOG_NOT_FOUND` | 404 |
| `BRAND_ALREADY_EXISTS` | 409 |
| `BRAND_NOT_FOUND` | 404 |
| `CART_EMPTY` | 400,404 |
| `CLEAR_CART_FAILED` | 500 |
| `CLIENT_ID_GENERATION_FAILED` | - |
| `CLIENT_REQUIRED` | 400 |
| `COMMENT_NOT_FOUND` | 404 |
| `CONFLICT` | 409 |
| `CONTACT_ID_REQUIRED` | 400 |
| `CONTACT_NOT_FOUND` | 404 |
| `CORRECTION_NOT_SAME_DAY` | 400 |
| `CORRECTION_WINDOW_EXCEEDED` | 400 |
| `CORS_BLOCKED` | 403 |
| `COUPON_INACTIVE` | 400 |
| `COUPON_MIN_AMOUNT_NOT_MET` | 400 |
| `COUPON_NOT_FOUND` | 404 |
| `CUSTOMER_NOT_FOUND` | 404 |
| `CUSTOMER_NO_REQUIRED` | 400 |
| `DAY_RECORD_NOT_FOUND` | 404 |
| `DEFAULT_ADDRESS_NOT_FOUND` | 404 |
| `DOCUMENT_NOT_FOUND` | 404 |
| `DOC_NOT_FOUND` | 404 |
| `DUPLICATE_KEY` | 409 |
| `DUPLICATE_REQUEST` | 400 |
| `DUPLICATE_VIDEO_LINK` | 409 |
| `EMAIL_EXISTS` | - |
| `EMAIL_REQUIRED` | 400 |
| `EMPLOYEE_ALREADY_EXISTS` | 400 |
| `EMPLOYEE_CODE_EXISTS` | 409 |
| `EMPLOYEE_NOT_FOUND` | 404 |
| `EMPLOYEE_RECORD_NOT_FOUND` | 404 |
| `EMP_NOT_FOUND` | 404 |
| `ENCRYPTION_NOT_CONFIGURED` | 500 |
| `EXECUTIVE_FORBIDDEN` | 403 |
| `EXTERNAL_SERVICE_ERROR` | 502 |
| `EXTERNAL_SERVICE_TIMEOUT` | 504 |
| `FETCH_CUSTOMERS_ERROR` | - |
| `FETCH_HOMEPAGE_REVIEWS_FAILED` | 500 |
| `FILE_TOO_LARGE` | 400 |
| `FILE_UPLOAD_ERROR` | 400 |
| `FILE_VALIDATION_ERROR` | 400 |
| `FORBIDDEN` | 403 |
| `FULL_DAY_LEAVE` | 400,403 |
| `FUTURE_DATE_NOT_ALLOWED` | - |
| `FUTURE_DATE` | 400 |
| `FUTURE_PUNCH_OUT` | 400 |
| `FUTURE_TIME_NOT_ALLOWED` | - |
| `GET_ALL_IP_ANALYTICS_FAILED` | 500 |
| `GET_CART_FAILED` | 500 |
| `GET_IP_ANALYTICS_FAILED` | 500 |
| `HALF_DAY_SESSION_REQUIRED` | 400 |
| `HALF_DAY_SINGLE_DATE` | 400 |
| `HIERARCHY_VIOLATION` | 403 |
| `HOLIDAY_BLOCK` | 400,403 |
| `HOLIDAY_EXISTS` | 409 |
| `HOLIDAY_NOT_FOUND` | 404 |
| `HOLIDAY_RESTRICTION` | - |
| `INSUFFICIENT_STOCK` | 400 |
| `INTERNAL_ERROR` | 500 |
| `INTERNAL_SERVER_ERROR` | - |
| `INVALID_ACTION` | 400 |
| `INVALID_ADDRESS_LABEL` | 400 |
| `INVALID_ADDRESS` | 400 |
| `INVALID_BILLING_ADDRESS` | 400 |
| `INVALID_BRAND` | 400 |
| `INVALID_CATEGORY` | 400 |
| `INVALID_COUPON` | 400 |
| `INVALID_CREDENTIALS` | 401 |
| `INVALID_DATE_FORMAT` | - |
| `INVALID_DATE_ORDER` | - |
| `INVALID_DATE_RANGE` | 400 |
| `INVALID_DATE` | 400 |
| `INVALID_DISCOUNT` | 400 |
| `INVALID_END_DATE` | 400 |
| `INVALID_FILE_TYPE` | 400 |
| `INVALID_ID` | 400 |
| `INVALID_IMAGE_TYPE` | 400 |
| `INVALID_ITEMS` | 400 |
| `INVALID_ITEM_DATA` | 400 |
| `INVALID_JSON` | 400 |
| `INVALID_MONTH` | 400 |
| `INVALID_OLD_PASSWORD` | 401 |
| `INVALID_ORDER_AMOUNT` | 400 |
| `INVALID_OR_EXPIRED_REFRESH_TOKEN` | 401 |
| `INVALID_OR_EXPIRED_TOKEN` | 401 |
| `INVALID_OR_MISSING_TOKEN` | 400 |
| `INVALID_OTP` | 400 |
| `INVALID_PAGINATION` | 400 |
| `INVALID_PAYMENT_METHOD` | 400 |
| `INVALID_PAYMENT_STATUS` | 400 |
| `INVALID_PRICE` | 400 |
| `INVALID_PUNCH_OUT_FORMAT` | 400 |
| `INVALID_PUNCH_OUT_ORDER` | - |
| `INVALID_PUNCH_OUT` | 400 |
| `INVALID_QUANTITY` | 400 |
| `INVALID_REQUEST_DATA` | 400 |
| `INVALID_ROLE` | 400 |
| `INVALID_START_DATE` | 400 |
| `INVALID_STATUS` | 400 |
| `INVALID_TIME_FORMAT` | - |
| `INVALID_TIME` | 400 |
| `INVALID_TOKEN` | 401 |
| `INVALID_URL` | 400 |
| `INVALID_YEAR` | 400 |
| `INVOICES_NOT_FOUND` | 404 |
| `INVOICE_FORBIDDEN` | 403 |
| `INVOICE_HAS_CREDIT_NOTES` | 400 |
| `INVOICE_HAS_SOURCE_ORDER` | 400 |
| `INVOICE_NOT_FOUND` | 404 |
| `INVOICE_NOT_PAID` | 400 |
| `IP_ANALYTICS_DASHBOARD_FAILED` | 500 |
| `ITEMS_MANAGED_BY_ORDER` | 400 |
| `ITEM_NOT_FOUND` | 404 |
| `JOB_NOT_FOUND` | 404 |
| `LEAVE_BACKDATE_LIMIT` | 400 |
| `LEAVE_NO_WORKING_DAYS` | 400 |
| `LEAVE_OVERLAP` | 409 |
| `LEAVE_REQUEST_NOT_FOUND` | 404 |
| `LEAVE_TOO_FAR_AHEAD` | 400 |
| `LIBRARY_DETAILS_REQUIRED` | 400 |
| `LOG_NOT_FOUND` | 404 |
| `MISSING_APPROVAL_ID` | 400 |
| `MISSING_FIELDS` | - |
| `MISSING_PUNCH_OUT` | - |
| `MISSING_REQUIRED_FIELDS` | 400 |
| `MONTH_FINALIZED` | 409 |
| `MONTH_NOT_FINALIZED` | 409 |
| `NOTHING_TO_UPDATE` | 400 |
| `NOT_FOUND` | 404 |
| `NOT_PUNCHED_IN` | 400 |
| `NO_CHANGES_DETECTED` | 400 |
| `NO_FILE_UPLOADED` | 400 |
| `NO_HOMEPAGE_REVIEWS` | 404 |
| `NO_LOGS_FOUND` | 404 |
| `NO_PUNCH_IN` | 400 |
| `ORDER_NOT_FOUND` | 404 |
| `ORDER_NOT_PAID` | 400 |
| `OTP_EXPIRED` | 400 |
| `OTP_NOT_FOUND` | 400,404 |
| `OTP_REQUIRED` | 400 |
| `OUT_OF_STOCK_POST_PAYMENT` | 409 |
| `PAGE_OUT_OF_RANGE` | 400 |
| `PASSWORDS_DO_NOT_MATCH` | 400 |
| `PASSWORD_UPDATE_NOT_ALLOWED` | 403 |
| `PAST_DATE` | 400 |
| `PAYROLL_PENDING_ITEMS` | 409 |
| `PERMISSION_CONFIG_MISSING` | INTERNAL_SERVER_ERROR |
| `PERMISSION_DENIED` | 403 |
| `PRODUCT_ID_REQUIRED` | 400 |
| `PRODUCT_NOT_AVAILABLE` | 404 |
| `PRODUCT_NOT_FOUND` | 404 |
| `PROFILE_NOT_FOUND` | 404 |
| `PUNCH_OUT_EXISTS` | 400 |
| `PUNCH_OUT_REQUIRED` | 400 |
| `RECORD_EXISTS` | 400 |
| `RECORD_NOT_FOUND_FOR_DATE` | 400 |
| `RECORD_NOT_FOUND` | 400,404 |
| `REFRESH_TOKEN_MISSING` | 401 |
| `REFRESH_TOKEN_REQUIRED` | 401 |
| `REFUND_EXCEEDS_PAID` | - |
| `REMOVE_CART_FAILED` | 500 |
| `RESUME_REQUIRED` | 400 |
| `REVIEW_NOT_FOUND` | 404 |
| `ROLE_REQUIRED` | 400 |
| `ROUTE_NOT_FOUND` | 404 |
| `SALARY_PROFILE_NOT_FOUND` | 404 |
| `SELF_ACTION_FORBIDDEN` | 403 |
| `SLUG_ALREADY_EXISTS` | 409 |
| `STORAGE_NOT_CONFIGURED` | 500 |
| `SUNDAY_BLOCK` | 403 |
| `TARGET_EMPLOYEE_NOT_FOUND` | 404 |
| `TESTIMONIAL_NOT_FOUND` | 404 |
| `TOKEN_EXPIRED` | 401 |
| `TOKEN_REQUIRED` | 400 |
| `TOO_MANY_REQUESTS` | 429 |
| `UNAUTHORIZED_ACTION` | 403 |
| `UNAUTHORIZED_ADMIN` | 401 |
| `UNAUTHORIZED` | 401 |
| `UPDATE_CART_FAILED` | 500 |
| `USER_EMAIL_MISSING` | 400 |
| `USER_ID_REQUIRED` | 400 |
| `USER_NOT_FOUND` | 404 |
| `VALIDATION_ERROR` | 400 |
| `VARIANTS_NOT_FOUND` | 404 |
| `VARIANT_NOT_AVAILABLE` | 404 |
| `VARIANT_NOT_FOUND` | 404 |
| `VARIANT_PRICE_REQUIRED` | 400 |
| `VERIFICATION_TOKEN_REQUIRED` | 400 |
| `VIDEO_NOT_FOUND` | 404 |
| `ZOHO_ACCOUNT_NOT_FOUND` | 404 |
| `ZOHO_API_ERROR` | 502 |
| `ZOHO_AUTH_FAILED` | 401,502 |
| `ZOHO_INVALID_RESPONSE` | 500 |
