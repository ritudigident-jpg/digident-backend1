import express from "express";
import {
  createManualOrder,
  getManualOrder,
  getAllManualOrders,
  updateManualOrderStatus,
  cancelManualOrder,
  createManualReturn,
  updateManualOrderCourier,
  getManualOrderAnalytics,
} from "../../controllers/manualOrder.controller.js";
import auth from "../../middlewares/auth.middleware.js";
import { checkPermission } from "../../middlewares/permission.middleware.js";

const router = express.Router();

router.post("/create", auth, checkPermission, createManualOrder);
router.get("/get/all/:permission", auth, checkPermission, getAllManualOrders);
router.get("/analytics/:permission", auth, checkPermission, getManualOrderAnalytics);
router.get("/get/:orderId/:permission", auth, checkPermission, getManualOrder);
router.patch("/status/:orderId", auth, checkPermission, updateManualOrderStatus);
router.put("/cancel/:orderId", auth, checkPermission, cancelManualOrder);
router.put("/courier/:orderId", auth, checkPermission, updateManualOrderCourier);
router.post("/return", auth, checkPermission, createManualReturn);

export default router;
