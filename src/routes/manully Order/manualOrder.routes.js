import express from "express";
import {
  createManualOrder,
  getManualOrder,
  getAllManualOrders,
  updateManualOrderStatus,
  cancelManualOrder,
  createManualReturn,
  updateManualOrderCourier,
} from "../../controllers/manualOrder.controller.js";
import auth from "../../middlewares/auth.middleware.js";
import { checkPermission } from "../../middlewares/permission.middleware.js";

const router = express.Router();

router.post("/create", auth, checkPermission, createManualOrder);
router.get("/get/all", auth, checkPermission, getAllManualOrders);
router.get("/get/:orderId", auth, checkPermission, getManualOrder);
router.patch("/:orderId/status", auth, checkPermission, updateManualOrderStatus);
router.put("/cancel/:orderId", auth, checkPermission, cancelManualOrder);
router.put("/courier/:orderId", auth, checkPermission, updateManualOrderCourier);
router.post("/return", auth, checkPermission, createManualReturn);

export default router;