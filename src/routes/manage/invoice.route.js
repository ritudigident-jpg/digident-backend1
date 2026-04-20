import express from "express";
import { createInvoice, getInvoiceById, getInvoices, updateInvoice,deleteInvoice } from "../../controllers/invoice/invoice.controller.js";
import auth from "../../middlewares/auth.middleware.js";
import { checkPermission } from "../../middlewares/permission.middleware.js";
const router = express.Router();

router.post("/create", auth,
  checkPermission(),
   createInvoice);
router.put("/update/:invoiceId", auth,
  checkPermission(),
   updateInvoice);
router.get("/get/:permission", auth,
  checkPermission(),
   getInvoices);
router.get("/get/:invoiceId/:permission", auth,
  checkPermission(),
   getInvoiceById);
router.delete("/delete/:invoiceId", auth,checkPermission(), deleteInvoice);  

export default router;