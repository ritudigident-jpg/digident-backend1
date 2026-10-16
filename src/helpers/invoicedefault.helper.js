/**
 * Default values for new invoices.
 *
 * Exports: getDefaultSellerDetails, getDefaultBankDetails
 * Used by: services/creditnote/creditnote.service.js, services/invoice/invoice.service.js
 */

/**
 * Get default seller details.
 * @returns {*}
 */
export const getDefaultSellerDetails = () => {
  return {
    companyName: "Digident India Pvt. Ltd.",
    address:
      "Digident India Pvt Ltd, 314, Professor Colony, Near Matlani Garden, Behind Agrawal Sweets, Sapna Sangita Road,Indore, (M.P.) 452001.",
    gstin: "23AAKCD9669F1ZA",
    email: "info@digident.in",
    contactNumber: "+91 9294503001",
  };
};

/**
 * Get default bank details.
 * @returns {*}
 */
export const getDefaultBankDetails = () => {
  return {
    accountNo: "00840510002087",
    accountType: "Current",
    ifscCode: "UCBA0000084",
    holderName: "Digident India Private Limited",
  };
};
