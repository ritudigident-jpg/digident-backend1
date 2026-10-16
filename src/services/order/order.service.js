/**
 * Business logic for shop orders: create, Razorpay payment, status, cancel, returns and refunds.
 * Throws AppError subclasses on failure.
 *
 * Exports: createOrderService, verifyRazorpayService, getUserOrdersService, getSingleOrderService,
 * cancelOrderService, markRefundCompletedService, updateOrderStatusService,
 * getOrdersByStatusService and 9 more
 * Used by: controllers/order/order.controller.js
 */

import User from "../../models/user.model.js";
import Cart from "../../models/cart.model.js";
import Product from "../../models/product.model.js";
import Coupon from "../../models/coupon.model.js";
import { v6 as uuidv6 } from "uuid";
import { getStock, resolvePrice, resolveImages } from "../product/productresolver.service.js";
import crypto from "crypto";
import Order from "../../models/order.model.js";
import Payment from "../../models/paymentaudit.model.js";
import StockAuditLog from "../../models/stockauditlog.model.js";
import { sendZohoMail } from "../zoho/zohomail.service.js";
import { orderConfirmationTemplate } from "../../templates/email/orderconfirmation.template.js";
import { adminOrderCancelledTemplate } from "../../templates/email/adminordercancelled.template.js";
import Employee from "../../models/employee.model.js";
import { razorpayInstance } from "../../config/razorpay.config.js";
import { getPagination } from "../../helpers/pagination.helper.js";
import mongoose from "mongoose";
import { PermissionAudit } from "../../models/permissionaudit.model.js";
import { sendNotification } from "../notification/notification.service.js";
import { orderStatusUpdateTemplate } from "../../templates/email/orderstatusupdate.template.js";
import {
  BadRequestError,
  ConflictError,
  ExternalServiceError,
  NotFoundError,
  UnauthorizedError,
} from "../../helpers/apperror.helper.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import { logger } from "../../helpers/logger.helper.js";

/* =========================================================================
   HELPER: Server-side coupon discount calculation
   -------------------------------------------------------------------------
   IMPORTANT: This is the single source of truth for discount amounts.
   The frontend may also compute a discount for display purposes, but that
   number must NEVER be trusted for the actual order total. Always recompute
   here using the coupon record fetched from the DB.

   cartLines: [{ productId, variantId, price, quantity, brandId }]
   ========================================================================= */
function calculateCouponDiscount(coupon, cartLines, subtotal) {
  if (!coupon) return 0;

  const { couponType, discountValue, maxDiscountAmount, buyXGetY } = coupon;

  if (couponType === "PERCENT") {
    const disc = (subtotal * (Number(discountValue) || 0)) / 100;
    return maxDiscountAmount ? Math.min(disc, Number(maxDiscountAmount)) : disc;
  }

  if (couponType === "FIXED") {
    return Math.min(Number(discountValue) || 0, subtotal);
  }

  if (couponType === "CASHBACK") {
    // Cashback does not reduce the payable order amount at checkout time.
    return 0;
  }

  if (couponType === "BUY_X_GET_Y_FREE" && buyXGetY) {
    const rule = buyXGetY;
    const getDiscountPct = Number(rule.getDiscountPercent ?? 100);

    if (rule.buyBrand) {
      const buyBrandId = rule.buyBrand?._id?.toString() || rule.buyBrand?.toString();
      const getBrandId = rule.getBrand?._id?.toString() || rule.getBrand?.toString();

      const buyQty = cartLines
        .filter((l) => l.brandId && l.brandId === buyBrandId)
        .reduce((acc, l) => acc + l.quantity, 0);

      const sets = Math.floor(buyQty / (rule.buyQuantity || 1));
      if (sets <= 0) return 0;

      const getItems = cartLines.filter((l) => l.brandId && l.brandId === getBrandId);
      let remaining = sets * (rule.getQuantity || 0);
      let discount = 0;

      for (const line of getItems) {
        if (remaining <= 0) break;
        const applyQty = Math.min(line.quantity, remaining);
        discount += line.price * applyQty * (getDiscountPct / 100);
        remaining -= applyQty;
      }
      return discount;
    }

    // No brand restriction -> cheapest item(s) in the cart become free
    if (rule.buyQuantity > 0) {
      const totalQty = cartLines.reduce((acc, l) => acc + l.quantity, 0);
      const sets = Math.floor(totalQty / rule.buyQuantity);
      let remaining = sets * (rule.getQuantity || 0);

      const sorted = [...cartLines].sort((a, b) => a.price - b.price);
      let discount = 0;

      for (const line of sorted) {
        if (remaining <= 0) break;
        const applyQty = Math.min(line.quantity, remaining);
        discount += line.price * applyQty * (getDiscountPct / 100);
        remaining -= applyQty;
      }
      return discount;
    }
  }

  return 0;
}

/* =========================================================================
   HELPER: Low stock alert (self-contained, no external template dependency)
   ========================================================================= */
const sendLowStockAlertToAdmins = async (lowStockProducts) => {
  if (!Array.isArray(lowStockProducts) || lowStockProducts.length === 0) return;

  try {
    const employees = await Employee.find({
      permissions: { $in: ["update_stock"] },
      isActive: true,
    });

    if (!employees || employees.length === 0) return;

    const rowsHtml = lowStockProducts
      .map(
        (p) =>
          `<li>${p.productName}${
            p.variantName && p.variantName !== "-" ? ` (${p.variantName})` : ""
          } — ${p.stockLeft} unit(s) left</li>`
      )
      .join("");

    const html = `<p>The following items are running low on stock:</p><ul>${rowsHtml}</ul>`;

    for (const emp of employees) {
      try {
        await sendZohoMail(emp.email, "Low Stock Alert", html);
      } catch (err) {
        logger.error(`Low stock email failed for ${emp.email}`, { error: err.message });
      }
    }
  } catch (err) {
    logger.error("Low stock alert failed", { error: err.message });
  }
};

/**
 * Create order.
 *
 * @param {*} data
 * @param {*} currentUser
 * @returns {Promise<*>}
 * @throws {UnauthorizedError} 401 when the caller is not logged in or the credentials are wrong.
 * @throws {NotFoundError} 404 when a record does not exist.
 * @throws {BadRequestError} 400 when the input breaks a rule.
 */
export const createOrderService = async (data, currentUser) => {
  if (!currentUser?._id) {
    throw new UnauthorizedError("Unauthorized user");
  }

  const user = await User.findById(currentUser._id).lean();
  if (!user) {
    throw new NotFoundError("User not found", { code: ERROR_CODES.USER_NOT_FOUND });
  }

  if (!user.cart) {
    throw new BadRequestError("Cart is empty", { code: ERROR_CODES.CART_EMPTY });
  }

  const cart = await Cart.findById(user.cart).lean();
  if (!cart || !Array.isArray(cart.items) || cart.items.length === 0) {
    throw new BadRequestError("Cart is empty", { code: ERROR_CODES.CART_EMPTY });
  }

  const {
    addressId,
    billingAddress,
    organizationName,
    gstNumber,
    couponId,
    gstAmount = 0,
    gstPercentage = 0,
    items: frontendItems,
    // NOTE: `discount` and `shippingCharge` are intentionally NOT read from
    // the client anymore. Both are always computed server-side below so a
    // tampered request body can never change the payable amount.
  } = data;

  if (!Array.isArray(frontendItems) || frontendItems.length === 0) {
    throw new BadRequestError("Cart is empty or items are required", { code: ERROR_CODES.INVALID_ITEMS });
  }

  if (!addressId) {
    throw new BadRequestError("addressId is required", { code: ERROR_CODES.ADDRESS_ID_REQUIRED });
  }

  if (!billingAddress || typeof billingAddress !== "object") {
    throw new BadRequestError("billingAddress is required", { code: ERROR_CODES.BILLING_ADDRESS_REQUIRED });
  }

  /* ================= BILLING ADDRESS VALIDATION ================= */
  const requiredBillingFields = [
    "fullName",
    "phone",
    "street",
    "area",
    "city",
    "state",
    "country",
    "pincode",
  ];
  for (const field of requiredBillingFields) {
    if (!billingAddress[field] || !String(billingAddress[field]).trim()) {
      throw new BadRequestError(`billingAddress.${field} is required`, {
        code: ERROR_CODES.INVALID_BILLING_ADDRESS,
      });
    }
  }

  /* ================= ADDRESS ================= */
  const possibleAddressSources = [user.addresses, user.shippingAddress, user.shippingAddresses, user.address];

  let addressList = [];

  for (const source of possibleAddressSources) {
    if (Array.isArray(source) && source.length > 0) {
      addressList = source;
      break;
    }
  }

  if (
    addressList.length === 0 &&
    user.shippingAddress &&
    typeof user.shippingAddress === "object" &&
    !Array.isArray(user.shippingAddress)
  ) {
    addressList = [user.shippingAddress];
  }

  if (
    addressList.length === 0 &&
    user.address &&
    typeof user.address === "object" &&
    !Array.isArray(user.address)
  ) {
    addressList = [user.address];
  }

  if (addressList.length === 0) {
    throw new BadRequestError("No addresses found for user", { code: ERROR_CODES.ADDRESS_NOT_FOUND });
  }

  const selectedAddress =
    addressList.find((addr) => addr?.addressId?.toString() === addressId?.toString()) ||
    addressList.find((addr) => addr?._id?.toString() === addressId?.toString()) ||
    addressList.find((addr) => addr?.id?.toString() === addressId?.toString());

  if (!selectedAddress) {
    throw new NotFoundError("Address not found", { code: ERROR_CODES.ADDRESS_NOT_FOUND });
  }

  const shippingAddress = {
    fullName:
      selectedAddress.fullName ||
      `${selectedAddress.firstName || ""} ${selectedAddress.lastName || ""}`.trim(),
    phone: selectedAddress.phone || "",
    street: selectedAddress.street || "",
    area: selectedAddress.area || "",
    city: selectedAddress.city || "",
    state: selectedAddress.state || "",
    country: selectedAddress.country || "",
    pincode: selectedAddress.pincode || "",
  };

  if (
    !shippingAddress.fullName ||
    !shippingAddress.phone ||
    !shippingAddress.street ||
    !shippingAddress.area ||
    !shippingAddress.city ||
    !shippingAddress.state ||
    !shippingAddress.country ||
    !shippingAddress.pincode
  ) {
    throw new BadRequestError("Selected address is incomplete", { code: ERROR_CODES.INVALID_ADDRESS });
  }

  /* ================= ITEMS ================= */
  let subtotal = 0;
  const items = [];
  const cartLines = []; // used only for server-side coupon discount calculation

  for (const item of frontendItems) {
    const { productId, variantId, quantity } = item;
    if (!productId || !variantId || !quantity || Number(quantity) <= 0) {
      throw new BadRequestError("Invalid item data", { code: ERROR_CODES.INVALID_ITEM_DATA });
    }
    const product = await Product.findOne({
      productId,
      status: "active",
    })
      .populate("category", "name")
      .lean();

    if (!product) {
      throw new NotFoundError(`Product unavailable: ${productId}`, { code: ERROR_CODES.PRODUCT_NOT_FOUND });
    }

    if (!Array.isArray(product.variants) || product.variants.length === 0) {
      throw new NotFoundError(`No variants available for product: ${productId}`, {
        code: ERROR_CODES.VARIANTS_NOT_FOUND,
      });
    }

    const variant = product.variants.find((v) => v?.variantId?.toString() === variantId?.toString());

    if (!variant) {
      throw new NotFoundError(`Variant unavailable: ${variantId}`, { code: ERROR_CODES.VARIANT_NOT_FOUND });
    }

    const availableStock = getStock(product, variantId);
    if (availableStock < Number(quantity)) {
      throw new BadRequestError(`Only ${availableStock} item(s) available for ${product.name}`, {
        code: ERROR_CODES.INSUFFICIENT_STOCK,
      });
    }

    const itemPrice = resolvePrice(product, variant);
    if (Number.isNaN(Number(itemPrice)) || Number(itemPrice) <= 0) {
      throw new BadRequestError(`Invalid product price for ${product.name}`, {
        code: ERROR_CODES.INVALID_PRICE,
      });
    }

    const resolvedImages = resolveImages(product, variant);
    const primaryImage = resolvedImages?.[0]?.url || resolvedImages?.[0] || "";

    const itemTotal = Number(itemPrice) * Number(quantity);
    subtotal += itemTotal;

    const attrObj = {};
    if (Array.isArray(variant.attributes)) {
      for (const attr of variant.attributes) {
        if (attr?.key) {
          attrObj[attr.key] = attr.value;
        }
      }
    }

    items.push({
      productId,
      variantId,
      sku: variant.sku || product.sku || "",
      productName: product.name || "",
      variantName: variant.name || "",
      categoryName: product.category?.name || "",
      price: Number(itemPrice),
      quantity: Number(quantity),
      attributes: attrObj,
      image: primaryImage,
    });

    cartLines.push({
      productId,
      variantId,
      price: Number(itemPrice),
      quantity: Number(quantity),
      brandId: product.brand?._id?.toString() || product.brand?.toString() || null,
    });
  }

  /* ================= SHIPPING (server controlled) ================= */
  // TODO: replace with real shipping calculation (pincode / weight based).
  // Client-supplied shippingCharge is intentionally ignored to prevent tampering.
  let finalShippingCharge = 0;

  /* ================= COUPON + DISCOUNT (server controlled) ================= */
  let appliedCoupon = null;
  let finalDiscount = 0;

  if (couponId) {
    const coupon = await Coupon.findOne({ couponId }).lean();
    if (!coupon) {
      throw new BadRequestError("Invalid coupon", { code: ERROR_CODES.INVALID_COUPON });
    }

    if (coupon.isActive === false) {
      throw new BadRequestError("This coupon is no longer active", { code: ERROR_CODES.COUPON_INACTIVE });
    }

    if (coupon.minOrderAmount && subtotal < coupon.minOrderAmount) {
      throw new BadRequestError(
        `Minimum order amount of ₹${coupon.minOrderAmount} required for this coupon`,
        { code: ERROR_CODES.COUPON_MIN_AMOUNT_NOT_MET }
      );
    }

    // Discount is ALWAYS computed here — the client's number is never used.
    finalDiscount = calculateCouponDiscount(coupon, cartLines, subtotal);

    if (coupon.couponType === "FREESHIP") {
      finalShippingCharge = 0;
    }

    appliedCoupon = {
      couponRef: coupon._id,
      couponId: coupon.couponId,
      code: coupon.code,
      couponType: coupon.couponType,
      discountAmount: finalDiscount,
      freeShipping: coupon.couponType === "FREESHIP",
    };
  }

  const grandTotal = Math.max(subtotal + finalShippingCharge - finalDiscount, 0);

  if (grandTotal <= 0) {
    throw new BadRequestError("Invalid order amount", { code: ERROR_CODES.INVALID_ORDER_AMOUNT });
  }

  /* ================= ORDER ITEM ================= */
  // NOTE: gstAmount / gstPercentage are still accepted from the client as-is.
  // This is a separate, lower-severity issue from the discount one — flagging
  // it here again: ideally these should be recomputed server-side too.
  const orderItem = {
    orderId: `ORD-${uuidv6()}`,
    user: user._id,
    items,
    shippingCharge: finalShippingCharge,
    grandTotal,
    coupon: appliedCoupon,
    billingAddress: {
      fullName: billingAddress.fullName,
      phone: billingAddress.phone,
      street: billingAddress.street,
      area: billingAddress.area,
      city: billingAddress.city,
      state: billingAddress.state,
      country: billingAddress.country,
      pincode: billingAddress.pincode,
    },
    shippingAddress,
    organizationName: organizationName || null,
    gstAmount: Number(gstAmount) || 0,
    gstPercentage: Number(gstPercentage) || 0,
    gstNumber: gstNumber || null,
    paymentStatus: "pending",
    orderStatus: "pending",
  };

  /* ================= RAZORPAY ================= */
  const razorpayOrder = await razorpayInstance.orders.create({
    amount: Math.round(grandTotal * 100),
    currency: "INR",
    receipt: orderItem.orderId,
  });

  /* ================= SAVE ORDER ================= */
  await Order.create({
    ...orderItem,
    razorpayOrderId: razorpayOrder.id,
  });

  /* ---------- NOTIFICATION ---------- */
  try {
    await sendNotification({
      sender: user._id,
      permission: "sales.order.update",
      title: "Order Created",
      message: `New order created for ${orderItem.orderId}`,
      type: "ORDER_CREATED",
      entityId: orderItem.orderId,
      entityModel: "Order",
      metadata: {
        orderId: orderItem.orderId,
        createdBy: user.email || null,
      },
    });
  } catch (err) {
    logger.error("Notification failed on create order", { error: err.message });
  }

  return {
    razorpayOrderId: razorpayOrder.id,
    amount: razorpayOrder.amount,
    currency: razorpayOrder.currency,
    orderItem,
  };
};

/**
 * Verify razorpay.
 *
 * @param {*} data
 * @param {*} currentUser
 * @returns {Promise<*>}
 * @throws {BadRequestError} 400 when the input breaks a rule.
 * @throws {UnauthorizedError} 401 when the caller is not logged in or the credentials are wrong.
 * @throws {ExternalServiceError} 502 when an external service (S3, Zoho, Razorpay) fails.
 * @throws {NotFoundError} 404 when a record does not exist.
 * @throws {ConflictError} 409 when the record already exists or was already processed.
 */
export const verifyRazorpayService = async (data, currentUser) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderItem } = data;

  /* ================= VALIDATION ================= */
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    throw new BadRequestError("Missing payment details");
  }

  if (!orderItem?.orderId) {
    throw new BadRequestError("Invalid order data");
  }

  if (!currentUser?._id) {
    throw new UnauthorizedError("Unauthorized user");
  }

  /* ================= VERIFY SIGNATURE ================= */
  const body = `${razorpay_order_id}|${razorpay_payment_id}`;
  const expectedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest("hex");

  if (expectedSignature !== razorpay_signature) {
    throw new ExternalServiceError("Invalid Razorpay signature");
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  let order;
  let user;
  const lowStockProducts = [];
  const deductedProducts = [];

  try {
    /* ================= USER ================= */
    user = await User.findById(currentUser._id).session(session);
    if (!user) {
      throw new NotFoundError("User not found", { code: ERROR_CODES.USER_NOT_FOUND });
    }

    /* ================= FIND EXISTING ORDER ================= */
    order = await Order.findOne({
      orderId: orderItem.orderId,
      user: currentUser._id,
      razorpayOrderId: razorpay_order_id,
    }).session(session);

    if (!order) {
      throw new NotFoundError("Order not found", { code: ERROR_CODES.ORDER_NOT_FOUND });
    }

    /* ================= PREVENT DOUBLE PAYMENT PROCESS ================= */
    if (order.paymentStatus === "paid") {
      throw new ConflictError("Order is already paid");
    }

    /* ================= STOCK RE-CHECK + DEDUCTION (session-safe) =================
       Stock is re-verified here (not just at order-creation time) because time
       may have passed between creating the Razorpay order and completing
       payment, during which another order could have consumed the stock. */
    for (const item of order.items) {
      const product = await Product.findOne({
        productId: item.productId,
        status: "active",
      }).session(session);

      if (!product) {
        throw new NotFoundError(`Product not found: ${item.productId}`);
      }

      const variant = product.variants.find((v) => v.variantId === item.variantId);
      if (!variant) {
        throw new NotFoundError(`Variant not found: ${item.variantId}`);
      }

      if (product.stockType === "PRODUCT") {
        if (product.productStock < item.quantity) {
          throw new ConflictError(
            `Insufficient stock for ${product.name}. Your payment was captured — please contact support for a refund.`,
            { code: ERROR_CODES.OUT_OF_STOCK_POST_PAYMENT }
          );
        }
        product.productStock -= item.quantity;
        if (product.productStock < 50) {
          lowStockProducts.push({
            productName: product.name,
            variantName: "-",
            stockLeft: product.productStock,
          });
        }
      } else {
        if (variant.variantStock < item.quantity) {
          throw new ConflictError(
            `Insufficient stock for ${product.name} (${variant.name}). Your payment was captured — please contact support for a refund.`,
            { code: ERROR_CODES.OUT_OF_STOCK_POST_PAYMENT }
          );
        }
        variant.variantStock -= item.quantity;
        if (variant.variantStock < 50) {
          lowStockProducts.push({
            productName: product.name,
            variantName: variant.name,
            stockLeft: variant.variantStock,
          });
        }
      }

      deductedProducts.push({
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
      });

      await product.save({ session });
    }

    /* ================= PAYMENT ================= */
    await Payment.create(
      [
        {
          paymentId: uuidv6(),
          order: order.orderId,
          user: user._id,
          razorpayOrderId: razorpay_order_id,
          razorpayPaymentId: razorpay_payment_id,
          razorpaySignature: razorpay_signature,
          amount: order.grandTotal,
          status: "success",
        },
      ],
      { session }
    );

    /* ================= UPDATE ORDER ================= */
    order.razorpayPaymentId = razorpay_payment_id;
    order.razorpaySignature = razorpay_signature;
    order.paymentStatus = "paid";
    order.orderStatus = "placed";
    order.paidAt = new Date();
    await order.save({ session });

    /* ================= STOCK LOG ================= */
    if (deductedProducts.length > 0) {
      await StockAuditLog.create([{ orderId: order.orderId, action: "deduct", products: deductedProducts }], {
        session,
      });
    }

    /* ================= CLEAR CART ================= */
    await Cart.findByIdAndUpdate(user.cart, { $set: { items: [] } }, { session });

    user.orderHistory.push({ orderId: order._id });
    await user.save({ session });

    await session.commitTransaction();
    session.endSession();
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }

  /* ================= SEND NOTIFICATION (after commit, non-blocking) ================= */
  try {
    await sendNotification({
      sender: user._id,
      permission: "order.listing.read",
      title: "New Order Placed",
      message: `Order ${order.orderId} has been placed successfully`,
      type: "ORDER_PLACED",
      entityId: order._id,
      entityModel: "Order",
      metadata: {
        orderId: order.orderId,
        customerName: `${user.firstName} ${user.lastName}`,
        customerEmail: user.email,
        paymentId: razorpay_payment_id,
        paymentStatus: order.paymentStatus,
        orderStatus: order.orderStatus,
        totalAmount: order.grandTotal,
        totalItems: order.items.length,
      },
    });
  } catch (err) {
    logger.error("Notification failed on verify payment", { error: err.message });
  }

  /* ================= EMAIL ================= */
  try {
    const emailHtml = orderConfirmationTemplate(user.firstName, order.orderId, order.grandTotal, order.items);

    await sendZohoMail(user.email, "Payment Successful - Order Confirmed", emailHtml);

    await sendLowStockAlertToAdmins(lowStockProducts);
  } catch (err) {
    logger.debug("EMAIL ERROR", { error: err.message });
  }

  return order;
};

/**
 * Get user orders.
 *
 * @param {*} query
 * @param {*} currentUser
 * @returns {Promise<*>}
 * @throws {UnauthorizedError} 401 when the caller is not logged in or the credentials are wrong.
 * @throws {BadRequestError} 400 when the input breaks a rule.
 */
export const getUserOrdersService = async (query, currentUser) => {
  if (!currentUser?._id) {
    throw new UnauthorizedError("Unauthorized user");
  }

  const { month, year } = query;
  const filter = { user: currentUser._id };
  if (month && year) {
    const m = Number(month);
    const y = Number(year);
    if (isNaN(m) || isNaN(y) || m < 1 || m > 12 || y < 2000) {
      throw new BadRequestError("Invalid month or year");
    }
    filter.createdAt = {
      $gte: new Date(y, m - 1, 1),
      $lt: new Date(y, m, 1),
    };
  }

  const orders = await Order.find(filter).sort({ createdAt: -1 }).lean();

  return {
    filters: {
      month: month || null,
      year: year || null,
    },
    orders,
  };
};

/**
 * Get single order.
 *
 * @param {*} orderId
 * @param {*} currentUser
 * @returns {Promise<*>}
 * @throws {UnauthorizedError} 401 when the caller is not logged in or the credentials are wrong.
 * @throws {BadRequestError} 400 when the input breaks a rule.
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const getSingleOrderService = async (orderId, currentUser) => {
  if (!currentUser?._id) {
    throw new UnauthorizedError("Unauthorized user");
  }

  if (!orderId) {
    throw new BadRequestError("orderId is required");
  }

  const order = await Order.findOne({
    orderId,
    user: currentUser._id,
  }).lean();

  if (!order) {
    throw new NotFoundError("Order not found", { code: ERROR_CODES.ORDER_NOT_FOUND });
  }

  return order;
};

/**
 * Cancel order.
 *
 * @param {*} orderId
 * @param {*} currentUser
 * @param {*} reason
 * @returns {Promise<*>}
 * @throws {UnauthorizedError} 401 when the caller is not logged in or the credentials are wrong.
 * @throws {BadRequestError} 400 when the input breaks a rule.
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const cancelOrderService = async (orderId, currentUser, reason) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (!currentUser?._id) {
      throw new UnauthorizedError("Unauthorized user");
    }

    if (!orderId) {
      throw new BadRequestError("orderId is required");
    }

    const order = await Order.findOne({ orderId, user: currentUser._id }).session(session);

    if (!order) {
      throw new NotFoundError("Order not found", { code: ERROR_CODES.ORDER_NOT_FOUND });
    }

    const nonCancellableStates = ["delivered", "cancelled", "shipped"];
    if (nonCancellableStates.includes(order.orderStatus)) {
      throw new BadRequestError(`Order cannot be cancelled once ${order.orderStatus}`);
    }

    // ----------------------------
    // RESTORE STOCK IF PAID
    // ----------------------------
    const restoredProducts = [];

    if (order.paymentStatus === "paid") {
      for (const item of order.items) {
        const product = await Product.findOne({ productId: item.productId, status: "active" }).session(
          session
        );

        if (!product) throw new NotFoundError(`Product not found: ${item.productName}`);

        if (product.stockType === "PRODUCT") {
          product.productStock += item.quantity;
        } else if (product.stockType === "VARIANT") {
          const variant = product.variants.find((v) => v.variantId === item.variantId);
          if (!variant) throw new NotFoundError(`Variant not found: ${item.variantName}`);
          variant.variantStock += item.quantity;
        }

        restoredProducts.push({
          productId: item.productId,
          variantId: item.variantId,
          quantity: item.quantity,
        });
        await product.save({ session });
      }

      if (restoredProducts.length > 0) {
        await StockAuditLog.create([{ orderId: order.orderId, action: "add", products: restoredProducts }], {
          session,
        });
      }
    }

    // ----------------------------
    // CANCEL ORDER
    // ----------------------------
    const cancelledAt = new Date();

    order.orderStatus = "cancelled";
    order.cancellationReason = reason?.trim() || "Cancelled by user";

    if (order.paymentStatus === "paid") {
      order.paymentStatus = "refund_pending";
      order.refundAmount = order.grandTotal;
    }

    order.cancelledAt = cancelledAt;

    await order.save({ session });
    await session.commitTransaction();
    session.endSession();

    // ----------------------------
    // ADMIN EMAIL AFTER COMMIT
    // ----------------------------
    try {
      const customerName =
        currentUser.firstName || currentUser.lastName
          ? `${currentUser.firstName || ""} ${currentUser.lastName || ""}`.trim()
          : currentUser.name || currentUser.email || "Customer";

      const emailHtml = adminOrderCancelledTemplate(
        order.orderId,
        customerName,
        currentUser.email,
        order.refundAmount,
        order.paymentStatus,
        order.cancellationReason,
        cancelledAt.toLocaleString()
      );

      await sendZohoMail(process.env.ADMIN_EMAIL, `Order Cancelled: ${order.orderId}`, emailHtml);
    } catch (err) {
      logger.error("Admin email failed", { error: err.message });
    }

    /* ---------- NOTIFICATION ---------- */
    try {
      await sendNotification({
        sender: currentUser._id,
        permission: "sales.order.update",
        title: "Order Cancelled",
        message: `Order ${order.orderId} has been cancelled`,
        type: "ORDER_CANCELLED",
        entityId: order._id,
        entityModel: "Order",
        metadata: {
          orderId: order.orderId,
          cancelledBy: currentUser.email || null,
        },
      });
    } catch (err) {
      logger.error("Notification failed on cancel order", { error: err.message });
    }

    return {
      orderId: order.orderId,
      orderStatus: order.orderStatus,
      paymentStatus: order.paymentStatus,
      refundAmount: order.refundAmount || 0,
      cancelledAt,
      cancellationReason: order.cancellationReason,
    };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

/**
 * Update order status.
 *
 * @param {*} data
 * @param {*} currentUser
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 * @throws {BadRequestError} 400 when the input breaks a rule.
 * @throws {ConflictError} 409 when the record already exists or was already processed.
 */
export const updateOrderStatusService = async (data, currentUser) => {
  const { orderId, status, permission } = data;

  /* ---------- AUTH ---------- */
  const employee = await Employee.findOne({ email: currentUser.email });
  if (!employee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }

  /* ---------- FETCH ORDER ---------- */
  const order = await Order.findOne({ orderId }).populate("user");
  if (!order) {
    throw new NotFoundError("Order not found", { code: ERROR_CODES.ORDER_NOT_FOUND });
  }

  const currentStatus = order.orderStatus;

  /* ---------- FINAL STATE CHECK ---------- */
  if (["cancelled", "returned"].includes(currentStatus)) {
    throw new BadRequestError(`Order cannot be updated because it is already ${currentStatus}`);
  }

  /* ---------- STATUS FLOW ---------- */
  const statusFlow = {
    placed: ["packed", "confirmed", "shipped"],
    packed: ["confirmed", "shipped"],
    confirmed: ["shipped"],
    shipped: ["delivered"],
  };

  if (currentStatus === status) {
    throw new BadRequestError(`Order already in status ${status}`);
  }

  const allowedNextStatuses = statusFlow[currentStatus] || [];

  if (!allowedNextStatuses.includes(status)) {
    throw new BadRequestError(`Invalid status update: cannot change from "${currentStatus}" to "${status}"`);
  }

  /* ---------- ATOMIC UPDATE ---------- */
  const now = new Date();
  const updateData = {
    orderStatus: status,
    statusUpdatedAt: now,
  };

  // Per-status timestamps only — payment fields are owned exclusively by
  // verifyRazorpayService and must never be touched here. Delivering an
  // order does not mean it was "paid just now"; for prepaid orders it was
  // already paid at checkout, and for COD-style flows payment confirmation
  // should be its own explicit action, not a side effect of "delivered".
  if (status === "confirmed") updateData.confirmedAt = now;
  if (status === "packed") updateData.packedAt = now;
  if (status === "shipped") updateData.shippedAt = now;
  if (status === "delivered") updateData.deliveredAt = now;

  const updatedOrder = await Order.findOneAndUpdate(
    { orderId, orderStatus: currentStatus },
    { $set: updateData },
    { new: true }
  ).populate("user");

  if (!updatedOrder) {
    throw new ConflictError("Order was modified by another process. Please retry.");
  }

  /* ---------- EMAIL (NON-BLOCKING) ---------- */
  try {
    const emailHtml = orderStatusUpdateTemplate(
      updatedOrder.user?.name || "Customer",
      updatedOrder.orderId,
      status
    );

    await sendZohoMail(updatedOrder.user?.email, `Order Update: ${updatedOrder.orderId}`, emailHtml);
  } catch (emailError) {
    logger.debug("Failed to send order status update email", { error: emailError.message });
  }

  /* ---------- AUDIT LOG ---------- */
  await PermissionAudit.create({
    permissionAuditId: uuidv6(),
    actionBy: employee._id,
    actionByEmail: employee.email,
    actionFor: updatedOrder._id,
    actionForEmail: updatedOrder.user?.email,
    permission: permission || "update_order_status",
    action: "update",
    meta: {
      from: currentStatus,
      to: status,
    },
  });

  /* ---------- NOTIFICATION ---------- */
  try {
    await sendNotification({
      sender: employee._id,
      permission: permission || "update_order_status",
      title: "Order Status Updated",
      message: `Order status updated to ${status} for ${updatedOrder.orderId}`,
      type: "ORDER_STATUS_UPDATED",
      entityId: updatedOrder._id,
      entityModel: "Order",
      metadata: {
        orderId: updatedOrder.orderId,
        updatedBy: employee.email || null,
      },
    });
  } catch (err) {
    logger.error("Notification failed on order status update", { error: err.message });
  }

  return {
    orderId: updatedOrder.orderId,
    oldStatus: currentStatus,
    newStatus: status,
    paymentStatus: updatedOrder.paymentStatus,
    statusUpdatedAt: updatedOrder.statusUpdatedAt,
  };
};

/**
 * Get orders by status.
 *
 * @param {*} data
 * @returns {Promise<*>}
 */
export const getOrdersByStatusService = async (data) => {
  const { status, page, limit } = data;

  const skip = (page - 1) * limit;

  const [orders, total] = await Promise.all([
    Order.find({ orderStatus: status }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),

    Order.countDocuments({ orderStatus: status }),
  ]);

  return {
    orders,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

/**
 * Get all orders admin.
 *
 * @param {object} params
 * @param {*} params.page
 * @param {*} params.limit
 * @returns {Promise<*>}
 */
export const getAllOrdersAdminService = async ({ page, limit }) => {
  const skip = (page - 1) * limit;
  const [orders, total] = await Promise.all([
    Order.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Order.countDocuments(),
  ]);
  return {
    orders,
    pagination: getPagination({ total, page, limit }),
  };
};

/**
 * Get all orders.
 *
 * @param {object} params
 * @param {*} params.page
 * @param {*} params.limit
 * @returns {Promise<*>}
 */
export const getAllOrdersService = async ({ page, limit }) => {
  const skip = (page - 1) * limit;

  const [orders, total] = await Promise.all([
    Order.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Order.countDocuments(),
  ]);

  return {
    orders,
    pagination: getPagination({ total, page, limit }),
  };
};

/**
 * Update courier details.
 *
 * @param {*} data
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const updateCourierDetailsService = async (data) => {
  const { orderId, corourseServiceName, DOCNumber, permission, userEmail } = data;

  /* ---------- FETCH EMPLOYEE ---------- */
  const employee = await Employee.findOne({ email: userEmail });

  if (!employee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }

  /* ---------- FETCH ORDER ---------- */
  const order = await Order.findOne({ orderId }).populate("user");

  if (!order) {
    throw new NotFoundError("Order not found", { code: ERROR_CODES.ORDER_NOT_FOUND });
  }

  /* ---------- UPDATE FIELDS ---------- */
  if (corourseServiceName) {
    order.corourseServiceName = corourseServiceName;
  }

  if (DOCNumber) {
    order.DOCNumber = DOCNumber;
  }

  order.statusUpdatedAt = new Date();

  await order.save();

  /* ---------- AUDIT LOG ---------- */
  await PermissionAudit.create({
    permissionAuditId: uuidv6(),
    actionBy: employee._id,
    actionByEmail: employee.email,
    actionFor: order._id,
    action: `Courier details updated for order ${order.orderId} (Service: ${order.corourseServiceName}, DOC: ${order.DOCNumber})`,
    permission: permission || "update_courier_details",
    actionType: "Update courier details",
  });

  return {
    orderId: order.orderId,
    corourseServiceName: order.corourseServiceName,
    DOCNumber: order.DOCNumber,
    updatedAt: order.statusUpdatedAt,
  };
};

export {
  createReturnRequestService,
  updatePendingReturnRequestService,
  getAllReturnRequestsService,
  updateReturnRequestStatusService,
} from "./orderreturn.service.js";

export { markRefundCompletedService, markRefundCompleteAdminService } from "./orderrefund.service.js";

export { salesDashboardService } from "./orderdashboard.service.js";
