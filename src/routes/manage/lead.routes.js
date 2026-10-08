import express from "express";
import * as lc from "../../controllers/lead.Controller.js";
import auth from "../../middlewares/auth.middleware.js";
import { uploadExcel } from "../../middlewares/multer.middleware.js";
import dentalLead from "../../models/manage/dentalLead.js";

const router = express.Router();
router.use(auth);

router.get("/dashboard",  lc.getDashboard);
router.get("/upcoming",   lc.getUpcomingFollowUps);
router.post("/import-excel", uploadExcel.single("file"), lc.importExcel);

// Direct client creation — must stay above "/:id"
router.get("/client-owners",  lc.getClientOwners);
router.post("/create-client", lc.createClient);

router.get("/",    lc.getAllLeads);
router.post("/",   lc.createLead);
router.get("/:id", lc.getLeadById);
router.put("/:id", lc.updateLead);
router.delete("/:id", lc.deleteLead);

router.patch("/:id/move-to-followup",   lc.moveToFollowup);
router.patch("/:id/convert-to-client",  lc.convertToClient);
router.patch("/:id/link-invoice",       lc.linkInvoice);
router.post("/:id/followup/:stageType", lc.logFollowUp);
router.post("/:id/remark-followup", lc.logRemarkFollowUp);
router.post("/:id/order", lc.logOrder);
router.post("/:id/flag",      lc.moveToFlag);
router.patch("/:id/call",     lc.incrementCallCount);
router.patch("/:id/whatsapp", lc.updateWhatsapp);

router.post("/distribute",             lc.distributeUnassigned);
router.post("/rebalance-untouched",    lc.rebalanceUntouched);
router.post("/agents/:employeeId/departure", lc.handleDeparture);

router.get("/admin/agents-overview",        lc.getAgentsOverview);
router.get("/admin/by-agent/:employeeId",   lc.getLeadsByAgent);

router.get("/debug/unassigned-count", auth, async (req, res) => {
  const count = await dentalLead.countDocuments({ assignedEmployee: null, isDeleted: false });
  const total = await dentalLead.countDocuments({ isDeleted: false });
  res.json({ unassignedCount: count, totalLeads: total });
});

// routes mein add karo temporarily
router.get("/debug/agents", auth, async (req, res) => {
  const Employee = (await import("../../models/manage/employee.model.js")).default;
  const agents = await Employee.find({ role: 4, isDeleted: false, isActive: { $ne: false } })
    .select("_id employeeId firstName lastName role isActive isDeleted");
  res.json({ count: agents.length, agents });
});

export default router;