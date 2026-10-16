/**
 * Routes for contact-form messages from the website. Mounted at /api/v1/contact (3 endpoints,
 * listed in docs/ENDPOINTS.md).
 *
 * Used by: app.js
 */

import express from "express";
import { createContact, getAllContacts, getContactById } from "../controllers/contact/contact.controller.js";

const router = express.Router();

// POST /api/contact
router.post("/create", createContact);
router.get("/get", getAllContacts);
router.get("/get/:contactId", getContactById);

export default router;
