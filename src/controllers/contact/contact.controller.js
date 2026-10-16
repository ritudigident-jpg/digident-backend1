/**
 * HTTP handlers for contact-form messages from the website: read the request, call the service,
 * send the response. No business logic here.
 *
 * Exports: createContact, getAllContacts, getContactById, deleteAllContacts
 * Used by: routes/contacts.routes.js
 */

import {
  createContactService,
  getAllContactsService,
  getContactByIdService,
  deleteAllContactsService,
} from "../../services/contact/contact.service.js";
import { contactValidationSchema } from "./contact.validator.js";

import { sendSuccess, sendCreated } from "../../helpers/response.helper.js";
import { getPagination } from "../../helpers/pagination.helper.js";
import { NotFoundError, ValidationError } from "../../helpers/apperror.helper.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import { asyncHandler } from "../../helpers/asynchandler.helper.js";

/**
 * @function createContact
 *
 * @params
 * body: {
 *   firstName: string,
 *   lastName: string,
 *   email: string,
 *   phone: string,
 *   message: string
 * }
 *
 * @process
 * Validate request body using Joi schema
 * Extract validated data
 * Create contact entry in database
 * Send email to user and admin (handled in service)
 * Return created contact
 *
 * @response
 * 201 {
 *   success: true,
 *   message: "Message saved and emails sent successfully!",
 *   data: contact
 * }
 */
export const createContact = asyncHandler(async (req, res) => {
  /* ---------- VALIDATION ---------- */
  const { error, value } = contactValidationSchema.validate(req.body, {
    abortEarly: false,
  });
  if (error) {
    throw ValidationError.fromJoi(error);
  }
  /* ---------- SERVICE CALL ---------- */
  const contact = await createContactService(value);
  /* ---------- RESPONSE ---------- */
  return sendCreated(res, { data: contact, message: "Message saved and emails sent successfully!" });
});

/**
 * @function getAllContacts
 *
 * @params
 * query: {
 *   page?: number,
 *   limit?: number
 * }
 *
 * @process
 * Extract page and limit from query
 * Set default values if not provided
 * Calculate skip value for pagination
 * Fetch contacts from service
 * Return paginated contacts
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Contact messages fetched successfully",
 *   data: {
 *     contacts,
 *     pagination
 *   }
 * }
 */
export const getAllContacts = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const { contacts, pagination } = await getAllContactsService({
    page,
    limit,
    skip,
  });
  return sendSuccess(res, { data: { contacts, pagination } });
});

/**
 * @function getContactById
 *
 * @params
 * params: {
 *   contactId: string
 * }
 *
 * @process
 * Extract contactId from params
 * Validate contactId
 * Fetch contact from database
 * Return contact details
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Contact fetched successfully",
 *   data: contact
 * }
 */
export const getContactById = asyncHandler(async (req, res) => {
  const { contactId } = req.params;
  /* ---------- VALIDATION ---------- */
  if (!contactId) {
    throw new ValidationError("ContactId is required");
  }
  /* ---------- SERVICE CALL ---------- */
  const contact = await getContactByIdService({ contactId });
  /* ---------- NOT FOUND ---------- */
  if (!contact) {
    throw new NotFoundError("Contact not found", { code: ERROR_CODES.NOT_FOUND });
  }
  /* ---------- SUCCESS ---------- */
  return sendSuccess(res, { data: contact, message: "Contact fetched successfully" });
});

/**
 * @function deleteAllContacts
 *
 * @process
 * Delete all contact messages from database
 * Return number of deleted records
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "All contact messages deleted successfully",
 *   data: { deletedCount }
 * }
 */
export const deleteAllContacts = asyncHandler(async (req, res) => {
  /* ---------- SERVICE CALL ---------- */
  const { deletedCount } = await deleteAllContactsService();
  /* ---------- NO DATA ---------- */
  if (deletedCount === 0) {
    return sendSuccess(res, { data: { deletedCount: 0 }, message: "No contact messages to delete" });
  }
  /* ---------- SUCCESS ---------- */
  return sendSuccess(res, { data: { deletedCount }, message: "All contact messages deleted successfully" });
});
