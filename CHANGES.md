# Restructure to Backend Architecture Standards v1.0.0

Files were moved/renamed and every import updated. **No API URL changed**: all 221 endpoints (method, path and middleware chain) were compared before and after and are identical, so no frontend changes are needed.

- `server.js` → `src/app.js`; `package.json` `dev`/`start` scripts updated. If your server or host runs `node server.js` directly, change it to `npm start` (or `node src/app.js`).
- `controllers/user/user.controller.js`: pagination import fixed from `../../../../src/helpers/…` to `../../helpers/…`.

## Moved / renamed (old → new)

- `server.js` → `src/app.js`
- `src/config/adminmail.js` → `src/config/mail.config.js`
- `src/config/passport.js` → `src/config/passport.config.js`
- `src/sockets/socket.js` → `src/config/socket.config.js`
- `src/controllers/AdminEmailSend.js` → `src/controllers/adminemail/adminemail.controller.js`
- `src/controllers/blog/blogView.controller.js` → `src/controllers/blogview/blogview.controller.js`
- `src/controllers/brand/ brand.validator.js` → `src/controllers/brand/brand.validator.js`
- `src/controllers/contact/contact.validation.js` → `src/controllers/contact/contact.validator.js`
- `src/controllers/auth/manage/employee.controller.js` → `src/controllers/employee/employee.controller.js`
- `src/controllers/auth/manage/employee.validator.js` → `src/controllers/employee/employee.validator.js`
- `src/controllers/ipanalytic/ipanalytic.controller.js` → `src/controllers/ipanalytics/ipanalytics.controller.js`
- `src/controllers/career/job.controller.js` → `src/controllers/job/job.controller.js`
- `src/controllers/career/job.validator.js` → `src/controllers/job/job.validator.js`
- `src/controllers/career/jobApplication.controller.js` → `src/controllers/jobapplication/jobapplication.controller.js`
- `src/controllers/career/jobApplication.validator.js` → `src/controllers/jobapplication/jobapplication.validator.js`
- `src/controllers/lead.Controller.js` → `src/controllers/lead/lead.controller.js`
- `src/controllers/libraryLog/libraryLog.controller.js` → `src/controllers/librarylog/librarylog.controller.js`
- `src/controllers/libraryLog/libaryLog.validator.js` → `src/controllers/librarylog/librarylog.validator.js`
- `src/controllers/manualOrder.controller.js` → `src/controllers/manualorder/manualorder.controller.js`
- `src/controllers/Notifaction/notification.controller.js` → `src/controllers/notification/notification.controller.js`
- `src/controllers/paymentaudit.controller.js` → `src/controllers/paymentaudit/paymentaudit.controller.js`
- `src/controllers/productReview/productReview.controller.js` → `src/controllers/productreview/productreview.controller.js`
- `src/controllers/productReview/productReview.validation.js` → `src/controllers/productreview/productreview.validator.js`
- `src/controllers/razorpaywebhook.controller.js` → `src/controllers/razorpaywebhook/razorpaywebhook.controller.js`
- `src/controllers/product/review.controller.js` → `src/controllers/review/review.controller.js`
- `src/controllers/product/review.validator.js` → `src/controllers/review/review.validator.js`
- `src/controllers/stockauditlog.controller.js` → `src/controllers/stockauditlog/stockauditlog.controller.js`
- `src/controllers/auth/ecommarace/user.controller.js` → `src/controllers/user/user.controller.js`
- `src/controllers/auth/ecommarace/user.validator.js` → `src/controllers/user/user.validator.js`
- `src/controllers/zoho/zohowebhook.controller.js` → `src/controllers/zohowebhook/zohowebhook.controller.js`
- `src/helpers/apiResponce.js` → `src/helpers/apiresponse.helper.js`
- `src/helpers/blogSeo.helper.js` → `src/helpers/blogseo.helper.js`
- `src/constants/date.js` → `src/helpers/date.helper.js`
- `src/helpers/invoiceDefault.helper.js` → `src/helpers/invoicedefault.helper.js`
- `src/helpers/generateInvoiceNumbers.js` → `src/helpers/invoicenumber.helper.js`
- `src/config/cron/autoMarkAbsent.js` → `src/jobs/automarkabsent.job.js`
- `src/config/cron/bestSeller.js` → `src/jobs/bestseller.job.js`
- `src/config/cron/couponExpiryCron.js` → `src/jobs/couponexpiry.job.js`
- `src/config/cron/employeeCleanup.js` → `src/jobs/employeecleanup.job.js`
- `src/middlewares/checkAdminRole.middleware.js` → `src/middlewares/adminrole.middleware.js`
- `src/middlewares/attechuser.middleware.js` → `src/middlewares/attachuser.middleware.js`
- `src/middlewares/errorHandle.middleware.js` → `src/middlewares/error.middleware.js`
- `src/middlewares/ipanalytic.middleware.js` → `src/middlewares/ipanalytics.middleware.js`
- `src/middlewares/morganLogger.middleware.js` → `src/middlewares/logger.middleware.js`
- `src/middlewares/parseMultipartJso.middleware.js` → `src/middlewares/multipartjson.middleware.js`
- `src/middlewares/puchAccess.Middleware.js` → `src/middlewares/punchaccess.middleware.js`
- `src/models/manage/approvalRequest.model.js` → `src/models/approvalrequest.model.js`
- `src/models/manage/attendance.model.js` → `src/models/attendance.model.js`
- `src/models/manage/attendanceapproval.model.js` → `src/models/attendanceapproval.model.js`
- `src/models/manage/banner.model.js` → `src/models/banner.model.js`
- `src/models/blog/blog.modal.js` → `src/models/blog.model.js`
- `src/models/blog/blogView.model.js` → `src/models/blogview.model.js`
- `src/models/manage/brand.model.js` → `src/models/brand.model.js`
- `src/models/ecommarace/cart.model.js` → `src/models/cart.model.js`
- `src/models/manage/category.model.js` → `src/models/category.model.js`
- `src/models/ecommarace/contact.model.js` → `src/models/contact.model.js`
- `src/models/manage/coupon.model.js` → `src/models/coupon.model.js`
- `src/models/ecommarace/customerData.model.js` → `src/models/customerdata.model.js`
- `src/models/manage/deleteemployee.model.js` → `src/models/deleteemployee.model.js`
- `src/models/ecommarace/dummyemailverify.model.js` → `src/models/dummyemailverify.model.js`
- `src/models/manage/employee.model.js` → `src/models/employee.model.js`
- `src/models/manage/invoice.model.js` → `src/models/invoice.model.js`
- `src/models/manage/ipdailyanalytics.model.js` → `src/models/ipdailyanalytics.model.js`
- `src/models/manage/job.model.js` → `src/models/job.model.js`
- `src/models/ecommarace/jobApplication.model.js` → `src/models/jobapplication.model.js`
- `src/models/manage/dentalLead.js` → `src/models/lead.model.js`
- `src/models/manually order/manualOrder.model.js` → `src/models/manualorder.model.js`
- `src/models/manage/notification.model.js` → `src/models/notification.model.js`
- `src/models/ecommarace/order.model.js` → `src/models/order.model.js`
- `src/models/ecommarace/paymentaudit.model.js` → `src/models/paymentaudit.model.js`
- `src/models/manage/permission.model.js` → `src/models/permission.model.js`
- `src/models/manage/permissionaudit.model.js` → `src/models/permissionaudit.model.js`
- `src/models/manage/product.model.js` → `src/models/product.model.js`
- `src/models/manage/productReview.model.js` → `src/models/productreview.model.js`
- `src/models/ecommarace/stockauditlog.model.js` → `src/models/stockauditlog.model.js`
- `src/models/ecommarace/user.model.js` → `src/models/user.model.js`
- `src/models/manage/video.model.js` → `src/models/video.model.js`
- `src/routes/ecommarace/address.routes.js` → `src/routes/addresses.routes.js`
- `src/routes/manage/attendance.routes.js` → `src/routes/attendance.routes.js`
- `src/routes/ecommarace/aws.routes.js` → `src/routes/aws.routes.js`
- `src/routes/manage/banner.routes.js` → `src/routes/banners.routes.js`
- `src/routes/blog/blog.route.js` → `src/routes/blogs.routes.js`
- `src/routes/manage/brand.routes.js` → `src/routes/brands.routes.js`
- `src/routes/career/career.routes.js` → `src/routes/careers.routes.js`
- `src/routes/ecommarace/cart.routes.js` → `src/routes/carts.routes.js`
- `src/routes/manage/category.routes.js` → `src/routes/categories.routes.js`
- `src/routes/ecommarace/contact.routes.js` → `src/routes/contacts.routes.js`
- `src/routes/manage/coupon.routes.js` → `src/routes/coupons.routes.js`
- `src/routes/manage/employee.routes.js` → `src/routes/employees.routes.js`
- `src/routes/manage/invoice.route.js` → `src/routes/invoices.routes.js`
- `src/routes/manage/ipanalytic.routes.js` → `src/routes/ipanalytics.routes.js`
- `src/routes/manage/lead.routes.js` → `src/routes/leads.routes.js`
- `src/routes/ecommarace/librarylog.routes.js` → `src/routes/librarylogs.routes.js`
- `src/routes/manully Order/manualOrder.routes.js` → `src/routes/manualorders.routes.js`
- `src/routes/manage/notification.routes.js` → `src/routes/notifications.routes.js`
- `src/routes/ecommarace/order.routes.js` → `src/routes/orders.routes.js`
- `src/routes/manage/permission.routes.js` → `src/routes/permissions.routes.js`
- `src/routes/manage/productReview.routes.js` → `src/routes/productreviews.routes.js`
- `src/routes/manage/product.routes.js` → `src/routes/products.routes.js`
- `src/routes/ecommarace/razorpay.routes.js` → `src/routes/razorpay.routes.js`
- `src/routes/ecommarace/razorpaywebhook.routes.js` → `src/routes/razorpaywebhook.routes.js`
- `src/routes/ecommarace/review.routes.js` → `src/routes/reviews.routes.js`
- `src/routes/ecommarace/stockauditlog.routes.js` → `src/routes/stockauditlogs.routes.js`
- `src/routes/ecommarace/user.routes.js` → `src/routes/users.routes.js`
- `src/routes/manage/video.routes.js` → `src/routes/videos.routes.js`
- `src/routes/zoho/zoho.routes.js` → `src/routes/zoho.routes.js`
- `src/routes/zoho/auth.routes.js` → `src/routes/zohoauth.routes.js`
- `src/routes/zoho/webhook.routes.js` → `src/routes/zohowebhook.routes.js`
- `src/services/address.service.js` → `src/services/address/address.service.js`
- `src/services/attendance.service.js` → `src/services/attendance/attendance.service.js`
- `src/services/awsS3.service.js` → `src/services/aws/aws.service.js`
- `src/services/banner.service.js` → `src/services/banner/banner.service.js`
- `src/services/blog.service.js` → `src/services/blog/blog.service.js`
- `src/services/brand.service.js` → `src/services/brand/brand.service.js`
- `src/services/cart.service.js` → `src/services/cart/cart.service.js`
- `src/services/category.service.js` → `src/services/category/category.service.js`
- `src/services/contact.service.js` → `src/services/contact/contact.service.js`
- `src/services/coupon.service.js` → `src/services/coupon/coupon.service.js`
- `src/services/auth/employee.service.js` → `src/services/employee/employee.service.js`
- `src/services/invoice.service.js` → `src/services/invoice/invoice.service.js`
- `src/services/ipanalytic.service.js` → `src/services/ipanalytics/ipanalytics.service.js`
- `src/services/job.service.js` → `src/services/job/job.service.js`
- `src/services/jobApplication.service.js` → `src/services/jobapplication/jobapplication.service.js`
- `src/services/assignment.service.js` → `src/services/lead/assignment.service.js`
- `src/services/lead.service.js` → `src/services/lead/lead.service.js`
- `src/services/libraryLog.service.js` → `src/services/librarylog/librarylog.service.js`
- `src/services/manualOrder.service.js` → `src/services/manualorder/manualorder.service.js`
- `src/services/notification.service.js` → `src/services/notification/notification.service.js`
- `src/services/order.service.js` → `src/services/order/order.service.js`
- `src/services/permission.service.js` → `src/services/permission/permission.service.js`
- `src/services/product.service.js` → `src/services/product/product.service.js`
- `src/services/productResolver.service.js` → `src/services/product/productresolver.service.js`
- `src/services/productReview.service.js` → `src/services/productreview/productreview.service.js`
- `src/services/review.service.js` → `src/services/review/review.service.js`
- `src/services/auth/user.service.js` → `src/services/user/user.service.js`
- `src/services/video.service.js` → `src/services/video/video.service.js`
- `src/services/ZohoEmail/zohoAuth.service.js` → `src/services/zoho/zohoauth.service.js`
- `src/services/ZohoEmail/zohoMail.service.js` → `src/services/zoho/zohomail.service.js`
- `src/services/zoho/zohowebhook.service.js` → `src/services/zohowebhook/zohowebhook.service.js`
- `src/config/templates/adminContact.js` → `src/templates/email/admincontact.template.js`
- `src/config/templates/adminLibraryRequestTemplat.js` → `src/templates/email/adminlibraryrequest.template.js`
- `src/config/templates/adminOrderCancelledTemplate.js` → `src/templates/email/adminordercancelled.template.js`
- `src/config/templates/applicationSubmittedTemplate.js` → `src/templates/email/applicationsubmitted.template.js`
- `src/config/templates/employeeWelcomeEmail.js` → `src/templates/email/employeewelcome.template.js`
- `src/config/templates/lowStockAlertTemplate.js` → `src/templates/email/lowstockalert.template.js`
- `src/config/templates/orderConfirmationTemplate.js` → `src/templates/email/orderconfirmation.template.js`
- `src/config/templates/orderStatusUpdateTemplate.js` → `src/templates/email/orderstatusupdate.template.js`
- `src/config/templates/otpEmailTemplate.js` → `src/templates/email/otp.template.js`
- `src/config/templates/passwordChangeApprovedMail.js` → `src/templates/email/passwordchangeapproved.template.js`
- `src/config/templates/permissionTemplate.js` → `src/templates/email/permission.template.js`
- `src/config/templates/resetPasswordTemplate.js` → `src/templates/email/resetpassword.template.js`
- `src/config/templates/userContact.js` → `src/templates/email/usercontact.template.js`
- `src/config/templates/userLibraryRequestTemplat.js` → `src/templates/email/userlibraryrequest.template.js`
- `src/config/templates/verifyUserEmail.js` → `src/templates/email/verifyuseremail.template.js`

## Added

- `.env.example`
- `README.md`
- `src/routes/stockauditlogs.routes.js`

## Files never loaded by the app (not deleted — check and remove if unused)

Several of these already had broken imports before the restructure (e.g. `../models/payment.model.js`, `../utils/responseHandler.js`, `razorpayWebhookontroller.js`), which confirms they are dead code.

- `src/controllers/adminemail/adminemail.controller.js`
- `src/controllers/paymentaudit/paymentaudit.controller.js`
- `src/controllers/zohowebhook/zohowebhook.controller.js`
- `src/services/zohowebhook/zohowebhook.service.js`
- `src/routes/razorpay.routes.js`
- `src/routes/zohowebhook.routes.js`
- `src/helpers/blogseo.helper.js`
- `src/models/approvalrequest.model.js`
- `src/templates/email/lowstockalert.template.js`
- `src/templates/email/passwordchangeapproved.template.js`
- `src/templates/email/permission.template.js`
- `src/middlewares/error.middleware.js` — the global error handler is never mounted in `app.js`
- `src/jobs/employeecleanup.job.js` — this cron job is never started

## Added after the first restructure (files sent separately)

These were not in the uploaded backend zip, which is an older copy than the live backend. They were added in the new structure with their imports fixed:

| File | Status |
|---|---|
| `src/controllers/testimonial/testimonial.controller.js` + `testimonial.validator.js` | ✅ live |
| `src/services/testimonial/testimonial.service.js` | ✅ live |
| `src/models/testimonial.model.js` | ✅ live |
| `src/routes/testimonials.routes.js` → mounted at `/api/v1/testimonial` (5 endpoints, matches Digi-Front-Main) | ✅ live |
| `src/controllers/creditnote/creditnote.controller.js` | ⏸ not mounted yet |
| `src/services/creditnote/creditnote.service.js` (the 731-line commented-out old copy at the top was removed; the live code is unchanged) | ⏸ not mounted yet |
| `src/models/creditnote.model.js` | ⏸ not mounted yet |
| `src/routes/creditnotes.routes.js` | ⏸ not mounted yet |
| `scripts/backfillordersfrominvoices.js` (import paths fixed; run `node scripts/backfillordersfrominvoices.js --employee-email=… [--confirm]` from the project root) | ✅ ready |

### To switch credit notes on
Credit notes need two things from your newer backend that are not in this zip:
1. `src/helpers/linkedsync.helper.js` exporting `syncPaymentToOrder` and `unlinkCreditNote`.
2. `settleInvoiceRefundService` exported from `src/services/invoice/invoice.service.js` (your current `invoice.service.js` is newer than the one in the zip — copy it over, and its routes in `invoices.routes.js`: `credit-settle`, `return`, `credit-lookup`).

Then uncomment the two `creditNote` lines in `src/app.js`.

### Security note
`testimonials.routes.js` has no `auth`: anyone can update, delete or publish (`isActive: true`) a testimonial.
