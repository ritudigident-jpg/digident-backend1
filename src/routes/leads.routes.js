/**
 * Routes for CRM leads: inquiry -> follow-up -> client, call remarks, agent assignment. Mounted at
 * /api/v1/leads (30 endpoints, listed in docs/ENDPOINTS.md).
 *
 * Used by: app.js
 */

import express from "express";
import * as lc from "../controllers/lead/lead.controller.js";
import auth from "../middlewares/auth.middleware.js";
import { uploadExcel } from "../middlewares/multer.middleware.js";

const router = express.Router();
router.use(auth);

router.get("/dashboard", lc.getDashboard);
router.get("/upcoming", lc.getUpcomingFollowUps);
router.post("/import-excel", uploadExcel.single("file"), lc.importExcel);

// Direct client creation — must stay above "/:id"
router.get("/client-owners", lc.getClientOwners);
router.post("/create-client", lc.createClient);

// NEW — "Select Client" picker (Create Invoice page). Must stay above "/:id"
router.get("/clients/search", lc.searchClients);

router.get("/", lc.getAllLeads);
router.post("/", lc.createLead);
router.get("/:id", lc.getLeadById);
router.put("/:id", lc.updateLead);
router.delete("/:id", lc.deleteLead);

// NEW — Client Profile page
router.get("/:id/profile", lc.getClientProfile);

router.patch("/:id/move-to-followup", lc.moveToFollowup);
router.patch("/:id/convert-to-client", lc.convertToClient);
router.patch("/:id/link-invoice", lc.linkInvoice);
router.post("/:id/followup/:stageType", lc.logFollowUp);
router.post("/:id/remark-followup", lc.logRemarkFollowUp);
router.post("/:id/order", lc.logOrder);
router.post("/:id/flag", lc.moveToFlag);
router.patch("/:id/call", lc.incrementCallCount);
router.patch("/:id/whatsapp", lc.updateWhatsapp);

router.post("/distribute", lc.distributeUnassigned);
router.post("/rebalance-untouched", lc.rebalanceUntouched);
router.post("/agents/:employeeId/departure", lc.handleDeparture);

router.get("/admin/agents-overview", lc.getAgentsOverview);
router.get("/admin/by-agent/:employeeId", lc.getLeadsByAgent);

// NEW — Agent Performance page (Admin / Super Admin only)
router.get("/admin/agent-performance", lc.getAgentPerformance);
router.get("/admin/agent-performance/:employeeId", lc.getAgentPerformanceDetail);

router.get("/debug/unassigned-count", auth, lc.getUnassignedCountDebug);
router.get("/debug/agents", auth, lc.getActiveAgentsDebug);

export default router;
