/**
 * Business logic for contact-form messages from the website. Throws AppError subclasses on failure.
 *
 * Exports: createContactService, getAllContactsService, getContactByIdService,
 * deleteAllContactsService
 * Used by: controllers/contact/contact.controller.js
 */

import Contact from "../../models/contact.model.js";
import { v6 as uuidv6 } from "uuid";
import { sendZohoMail } from "../zoho/zohomail.service.js";
import { adminContactTemplate } from "../../templates/email/admincontact.template.js";
import { userContactTemplate } from "../../templates/email/usercontact.template.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import { BadRequestError, NotFoundError } from "../../helpers/apperror.helper.js";
import { logger } from "../../helpers/logger.helper.js";

/**
 * Create contact.
 *
 * @param {object} params
 * @param {*} params.firstName
 * @param {*} params.lastName
 * @param {*} params.email
 * @param {*} params.phone
 * @param {*} params.message
 * @returns {Promise<*>}
 */
export const createContactService = async ({ firstName, lastName, email, phone, message }) => {
  /* ---------- CREATE CONTACT ---------- */
  const newContact = await Contact.create({
    contactId: uuidv6(),
    firstName,
    lastName,
    email,
    phone,
    message,
  });

  /* ---------- SEND EMAILS (NON-BLOCKING) ---------- */
  sendEmails({
    firstName,
    lastName,
    email,
    phone,
    message,
  });
  return newContact;
};

/* ---------- EMAIL HANDLER ---------- */
const sendEmails = async ({ firstName, lastName, email, phone, message }) => {
  /* ---------- USER EMAIL ---------- */
  sendZohoMail(
    email,
    "We’ve received your message | Digident Support",
    userContactTemplate(firstName, message)
  ).catch((err) => {
    logger.error("User email failed", { error: err.message });
  });
  /* ---------- ADMIN EMAIL ---------- */
  sendZohoMail(
    process.env.ADMIN_EMAIL,
    `New Contact from ${firstName} ${lastName}`,
    adminContactTemplate(firstName, lastName, email, phone, message)
  ).catch((err) => {
    logger.error("Admin email failed", { error: err.message });
  });
};

/**
 * Get all contacts.
 *
 * @param {object} params
 * @param {*} params.page
 * @param {*} params.limit
 * @param {*} params.skip
 * @returns {Promise<*>}
 */
export const getAllContactsService = async ({ page, limit, skip }) => {
  const [totalContacts, contacts] = await Promise.all([
    Contact.countDocuments(),
    Contact.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
  ]);
  return {
    contacts,
    pagination: {
      totalContacts,
      totalPages: Math.ceil(totalContacts / limit),
      currentPage: page,
      limit,
    },
  };
};

/**
 * Get contact by id.
 *
 * @param {object} params
 * @param {*} params.contactId
 * @returns {Promise<*>}
 * @throws {BadRequestError} 400 when the input breaks a rule.
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const getContactByIdService = async ({ contactId }) => {
  if (!contactId) {
    throw new BadRequestError("Contact id required", { code: ERROR_CODES.CONTACT_ID_REQUIRED });
  }
  const contact = await Contact.findOne({ contactId }).lean();
  if (!contact) {
    throw new NotFoundError("Contact not found", { code: ERROR_CODES.CONTACT_NOT_FOUND });
  }
  return contact;
};

/**
 * Delete all contacts.
 * @returns {Promise<*>}
 */
export const deleteAllContactsService = async () => {
  const result = await Contact.deleteMany({});
  return {
    deletedCount: result.deletedCount,
  };
};
