import express from "express";
import * as lc from "../../controllers/lead.Controller.js";
import auth from "../../middlewares/auth.middleware.js";
import { uploadExcel } from "../../middlewares/multer.middleware.js";


const router = express.Router();

router.use(auth);

/* ── Special (must be before /:id) ──────────────────────────────────────── */
router.get("/dashboard",  lc.getDashboard);
router.get("/upcoming",   lc.getUpcomingFollowUps);      // ?daysAhead=7
router.post("/import-excel", uploadExcel.single("file"), lc.importExcel);

/* ── CRUD ───────────────────────────────────────────────────────────────── */
router.get("/",    lc.getAllLeads);  // ?stage=followup&search=mehta&page=1&limit=10
router.post("/",   lc.createLead);
router.get("/:id", lc.getLeadById);
router.put("/:id", lc.updateLead);
router.delete("/:id", lc.deleteLead);

/* ── Pipeline actions ────────────────────────────────────────────────────── */
router.patch("/:id/move-to-followup",   lc.moveToFollowup);
router.patch("/:id/convert-to-client",  lc.convertToClient);
router.post("/:id/followup/:stageType", lc.logFollowUp);   // pre-sale | post-sale
router.post("/:id/remark-followup", lc.logRemarkFollowUp);
router.post("/:id/order", lc.logOrder);
router.post("/:id/flag",      lc.moveToFlag);
router.patch("/:id/call",     lc.incrementCallCount);
router.patch("/:id/whatsapp", lc.updateWhatsapp);

/* ── Assignment / distribution (Admin only) ─────────────────────────────── */
router.post("/distribute",             lc.distributeUnassigned);      // after excel import
router.post("/rebalance-untouched",    lc.rebalanceUntouched);        // after new agent added
router.post("/agents/:employeeId/departure", lc.handleDeparture);      // { mode, targetEmployeeId?, reason? }

export default router;