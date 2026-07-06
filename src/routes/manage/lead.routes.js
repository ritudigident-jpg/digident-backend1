import express from "express";
import * as lc from "../../controllers/lead.Controller.js";
import auth from "../../middlewares/auth.middleware.js";
import { uploadExcel } from "../../middlewares/multer.middleware.js";

const router = express.Router();
router.use(auth);

router.get("/dashboard",  lc.getDashboard);
router.get("/upcoming",   lc.getUpcomingFollowUps);
router.post("/import-excel", uploadExcel.single("file"), lc.importExcel);

router.get("/",    lc.getAllLeads);
router.post("/",   lc.createLead);
router.get("/:id", lc.getLeadById);
router.put("/:id", lc.updateLead);
router.delete("/:id", lc.deleteLead);

router.patch("/:id/move-to-followup",   lc.moveToFollowup);
router.patch("/:id/convert-to-client",  lc.convertToClient);
router.post("/:id/followup/:stageType", lc.logFollowUp);
router.post("/:id/remark-followup", lc.logRemarkFollowUp);
router.post("/:id/order", lc.logOrder);
router.post("/:id/flag",      lc.moveToFlag);
router.patch("/:id/call",     lc.incrementCallCount);
router.patch("/:id/whatsapp", lc.updateWhatsapp);

router.post("/distribute",             lc.distributeUnassigned);
router.post("/rebalance-untouched",    lc.rebalanceUntouched);
router.post("/agents/:employeeId/departure", lc.handleDeparture);

export default router;