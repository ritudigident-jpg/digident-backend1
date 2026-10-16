/**
 * Business logic for a shop customer's saved delivery addresses. Throws AppError subclasses on
 * failure.
 *
 * Exports: addAddressService, updateAddressService, deleteAddressService,
 * clearAllAddressesService, getDefaultAddressService, setDefaultAddressService
 * Used by: controllers/address/address.controller.js
 */

import { v6 as uuidv6 } from "uuid";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../helpers/apperror.helper.js";
/**
 * Add address.
 *
 * @param {*} user
 * @param {*} data
 * @returns {Promise<*>}
 * @throws {BadRequestError} 400 when the input breaks a rule.
 * @throws {ConflictError} 409 when the record already exists or was already processed.
 */
export const addAddressService = async (user, data) => {
  const {
    label,
    firstName,
    lastName,
    phone,
    street,
    area,
    city,
    state,
    pincode,
    country,
    isDefault = false,
  } = data;
  if (!user.address) {
    user.address = []; // ✅ prevent crash
  }
  const allowedLabels = ["Home", "Work", "Other"];
  if (!allowedLabels.includes(label)) {
    throw new BadRequestError("Invalid address label", { code: ERROR_CODES.INVALID_ADDRESS_LABEL });
  }
  const duplicate = user.address.some((a) => a.street === street && a.area === area);
  if (duplicate) {
    throw new ConflictError("Address already exists", { code: ERROR_CODES.ADDRESS_ALREADY_EXISTS });
  }
  if (isDefault) {
    user.address.forEach((a) => {
      a.isDefault = false;
    });
  }
  const newAddress = {
    addressId: uuidv6(),
    label,
    firstName,
    lastName,
    phone,
    street,
    area,
    city,
    state,
    pincode,
    country,
    isDefault,
  };
  user.address.push(newAddress);
  await user.save();
  return user.address;
};

/**
 * Update address.
 *
 * @param {*} user
 * @param {*} addressId
 * @param {*} updates
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const updateAddressService = async (user, addressId, updates) => {
  const addressIndex = user.address.findIndex((addr) => addr.addressId === addressId);
  if (addressIndex === -1) {
    throw new NotFoundError("Address not found", { code: ERROR_CODES.ADDRESS_NOT_FOUND });
  }
  delete updates.addressId;
  if (updates.isDefault === true) {
    user.address.forEach((addr) => {
      addr.isDefault = false;
    });
  }
  const allowedFields = [
    "label",
    "firstName",
    "lastName",
    "phone",
    "street",
    "area",
    "city",
    "state",
    "pincode",
    "country",
    "isDefault",
  ];
  allowedFields.forEach((field) => {
    if (updates[field] !== undefined) {
      user.address[addressIndex][field] = updates[field];
    }
  });
  await user.save();
  return user.address;
};

/**
 * Delete address.
 *
 * @param {*} user
 * @param {*} addressId
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const deleteAddressService = async (user, addressId) => {
  const addressIndex = user.address.findIndex((addr) => addr.addressId === addressId);
  if (addressIndex === -1) {
    throw new NotFoundError("Address not found", { code: ERROR_CODES.ADDRESS_NOT_FOUND });
  }
  const wasDefault = user.address[addressIndex].isDefault;
  user.address.splice(addressIndex, 1);
  if (wasDefault && user.address.length > 0) {
    user.address[0].isDefault = true;
  }
  await user.save();
  return user.address;
};

/**
 * Clear all addresses.
 *
 * @param {*} user
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const clearAllAddressesService = async (user) => {
  if (!user) {
    throw new NotFoundError("User not found", { code: ERROR_CODES.USER_NOT_FOUND });
  }
  /* If already empty */
  if (!user.address || user.address.length === 0) {
    return [];
  }
  /* Clear all addresses */
  user.address = [];
  await user.save();
  return user.address;
};

/**
 * Get default address.
 *
 * @param {*} user
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const getDefaultAddressService = async (user) => {
  if (!user) {
    throw new NotFoundError("User not found", { code: ERROR_CODES.USER_NOT_FOUND });
  }

  const address = user?.address?.find((addr) => addr.isDefault === true);

  if (!address) {
    throw new NotFoundError("No default address found", { code: ERROR_CODES.DEFAULT_ADDRESS_NOT_FOUND });
  }
  return address;
};

/**
 * Set default address.
 *
 * @param {*} user
 * @param {*} addressId
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 * @throws {BadRequestError} 400 when the input breaks a rule.
 */
export const setDefaultAddressService = async (user, addressId) => {
  if (!user) {
    throw new NotFoundError("User not found", { code: ERROR_CODES.USER_NOT_FOUND });
  }

  if (!addressId) {
    throw new BadRequestError("AddressId is required", { code: ERROR_CODES.VALIDATION_ERROR });
  }

  const addressIndex = user?.address?.findIndex((addr) => addr.addressId === addressId);
  if (addressIndex === -1 || addressIndex === undefined) {
    throw new NotFoundError("Address not found", { code: ERROR_CODES.ADDRESS_NOT_FOUND });
  }

  // ✅ Avoid unnecessary DB write
  if (user.address[addressIndex].isDefault) {
    return user.address;
  }

  // ✅ Reset all defaults
  user.address.forEach((addr) => {
    addr.isDefault = false;
  });

  // ✅ Set selected as default
  user.address[addressIndex].isDefault = true;

  await user.save();

  return user.address;
};
