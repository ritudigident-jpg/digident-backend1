// import express from "express";
// import { createOrder,getUserOrders,getSingleOrder,cancelOrder,updateOrderStatus,getAllOrdersAdmin,getOrdersByStatus,markRefundCompleted,salesDashboard,verifyRazorpay,getAllOrders,markRefundCompleteAdmin,createReturnRequest,getAllReturnRequests,updatePendingReturnRequest,updateReturnRequestStatus,updateCourierDetails} from "../../controllers/order/order.controller.js";
// import auth from "../../middlewares/auth.middleware.js";
// import { attachUser } from "../../middlewares/attechuser.middleware.js";
// import { checkPermission } from "../../middlewares/permission.middleware.js";

// const router = express.Router();
// // ADMIN ROUTES
// router.get("/get/all", getAllOrdersAdmin);
// router.patch("/:orderId/status",auth,checkPermission, updateOrderStatus);
// router.get("/get/status/:status", getOrdersByStatus);
// // USER ROUTES
// router.post("/create",auth,attachUser, createOrder);
// router.post('/verifyRazorpay',auth,attachUser,verifyRazorpay)
// router.get("/my-orders",auth,attachUser, getUserOrders);
// // router.post("/payment/initiate/:orderId", employeeVerifyAccessToken, initiatePayment);
// router.put("/cancel/:orderId",auth, attachUser, cancelOrder);
// router.get("/get/:orderId",auth,attachUser, getSingleOrder);
// router.put("/refund/complete/admin/:orderId",auth,checkPermission,markRefundCompleteAdmin);
// // router.delete("/delete", deleteAllOrders);
// // add middleware to verify user and attach user
// router.put("/refund/complete/:orderId",markRefundCompleted);
// router.get("/dashboard", salesDashboard); 
// router.get("/allorders",getAllOrders)
// router.post("/return",auth,attachUser, createReturnRequest);
// router.put("/return/update/:orderId/:requestId",auth,attachUser,updatePendingReturnRequest);
// router.get("/return-req/get",getAllReturnRequests);
// router.put("/return/update/status/:orderId/:requestId",auth,checkPermission, updateReturnRequestStatus);
// router.put("/courier/:orderId",auth,checkPermission,updateCourierDetails);
// export default router;
import express from "express";
import {
  createOrder,
  getUserOrders,
  getSingleOrder,
  cancelOrder,
  updateOrderStatus,
  getAllOrdersAdmin,
  getOrdersByStatus,
  markRefundCompleted,
  salesDashboard,
  verifyRazorpay,
  getAllOrders,
  markRefundCompleteAdmin,
  createReturnRequest,
  getAllReturnRequests,
  updatePendingReturnRequest,
  updateReturnRequestStatus,
  updateCourierDetails,
} from "../../controllers/order/order.controller.js";
import auth from "../../middlewares/auth.middleware.js";
import { attachUser } from "../../middlewares/attechuser.middleware.js";
import { checkPermission } from "../../middlewares/permission.middleware.js";

const router = express.Router();

// ===================== ADMIN / EMPLOYEE ROUTES =====================
// All of these were previously public — now require an authenticated
// employee session with the right permission.
router.get("/get/all", auth, checkPermission, getAllOrdersAdmin);
router.patch("/:orderId/status", auth, checkPermission, updateOrderStatus);
router.get("/get/status/:status", auth, checkPermission, getOrdersByStatus);
router.put("/refund/complete/admin/:orderId", auth, checkPermission, markRefundCompleteAdmin);
router.get("/return-req/get", auth, checkPermission, getAllReturnRequests);
router.get("/allorders", auth, checkPermission, getAllOrders);
router.get("/dashboard", auth, checkPermission, salesDashboard);
router.put("/return/update/status/:orderId/:requestId", auth, checkPermission, updateReturnRequestStatus);
router.put("/courier/:orderId", auth, checkPermission, updateCourierDetails);

// ===================== USER ROUTES =====================
router.post("/create", auth, attachUser, createOrder);
router.post("/verifyRazorpay", auth, attachUser, verifyRazorpay);
router.get("/my-orders", auth, attachUser, getUserOrders);
router.put("/cancel/:orderId", auth, attachUser, cancelOrder);
router.get("/get/:orderId", auth, attachUser, getSingleOrder);

// NOTE: this was previously unauthenticated. It is now guarded with
// auth + attachUser and the service checks that the order belongs to
// the requesting user (or that the caller is an employee).
router.put("/refund/complete/:orderId", auth, attachUser, markRefundCompleted);

router.post("/return", auth, attachUser, createReturnRequest);
router.put("/return/update/:orderId/:requestId", auth, attachUser, updatePendingReturnRequest);

export default router;

/*
 * IMPORTANT FRONTEND NOTE:
 * ApiService.js calls `completeRefund` with `apiClient.post(...)`, but this
 * route is registered as `router.put(...)`. Align one side with the other —
 * either change the frontend call to `apiClient.put`, or change this route
 * to `router.post`. Left as PUT here to match the original backend; update
 * ApiService.js accordingly:
 *
 *   export const completeRefund = (id) =>
 *     safeRequest(apiClient.put(API_ROUTES.ORDERS.REFUND_COMPLETE(id)));
 */
