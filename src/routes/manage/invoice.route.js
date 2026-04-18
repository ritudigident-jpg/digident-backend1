import express from "express";
import { createInvoice, getInvoiceById, getInvoices, updateInvoice } from "../../controllers/invoice/invoice.controller.js";

const router = express.Router();

router.post("/create", createInvoice);
router.put("/update/:invoiceId", updateInvoice);
router.get("/get", getInvoices);
router.get("/get/:invoiceId", getInvoiceById);

export default router;