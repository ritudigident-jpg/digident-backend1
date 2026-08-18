import express from "express";
import {
  createManualOrder,
  getManualOrder,
  getAllManualOrders,
  updateManualOrderStatus,
  updateManualOrderPaymentStatus,
  cancelManualOrder,
  createManualReturn,
  updateManualOrderCourier,
  getManualOrderAnalytics,
  getCustomerBalanceLedger,
  settleOrderCredit,
  getCreditNotes,
} from "../../controllers/manualOrder.controller.js";
import auth from "../../middlewares/auth.middleware.js";
import { checkPermission } from "../../middlewares/permission.middleware.js";

const router = express.Router();

router.post("/create", auth, checkPermission, createManualOrder);
router.get("/get/all/:permission", auth, checkPermission, getAllManualOrders);
router.get("/analytics/:permission", auth, checkPermission, getManualOrderAnalytics);
router.get("/ledger/:permission", auth, checkPermission, getCustomerBalanceLedger);
router.get("/credit-notes/:permission", auth, checkPermission, getCreditNotes);
router.get("/get/:orderId/:permission", auth, checkPermission, getManualOrder);
router.patch("/status/:orderId", auth, checkPermission, updateManualOrderStatus);
router.patch("/payment-status/:orderId", auth, checkPermission, updateManualOrderPaymentStatus);
router.put("/cancel/:orderId", auth, checkPermission, cancelManualOrder);
router.put("/courier/:orderId", auth, checkPermission, updateManualOrderCourier);
router.put("/credit-settle/:orderId", auth, checkPermission, settleOrderCredit);
router.post("/return", auth, checkPermission, createManualReturn);

export default router;
