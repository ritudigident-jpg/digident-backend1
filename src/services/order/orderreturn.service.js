/**
 * Return requests of shop orders: create, update while pending, list, approve / reject (stock and refund amounts). Re-exported by order.service.js.
 */
import Product from "../../models/product.model.js";
import { v6 as uuidv6 } from "uuid";
import Order from "../../models/order.model.js";
import StockAuditLog from "../../models/stockauditlog.model.js";
import { sendZohoMail } from "../zoho/zohomail.service.js";
import Employee from "../../models/employee.model.js";
import mongoose from "mongoose";
import { PermissionAudit } from "../../models/permissionaudit.model.js";
import { sendNotification } from "../notification/notification.service.js";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  UnauthorizedError,
} from "../../helpers/apperror.helper.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import { logger } from "../../helpers/logger.helper.js";

/**
 * Create return request.
 *
 * @param {*} data
 * @param {*} currentUser
 * @returns {Promise<*>}
 * @throws {UnauthorizedError} 401 when the caller is not logged in or the credentials are wrong.
 * @throws {NotFoundError} 404 when a record does not exist.
 * @throws {BadRequestError} 400 when the input breaks a rule.
 */
export const createReturnRequestService = async (data, currentUser) => {
  const { orderId, returnItems } = data;

  if (!currentUser?._id) {
    throw new UnauthorizedError("Unauthorized user");
  }

  /* ================= FIND ORDER (ownership enforced) ================= */
  const order = await Order.findOne({ orderId, user: currentUser._id }).populate("user");
  if (!order) {
    throw new NotFoundError("Order not found", { code: ERROR_CODES.ORDER_NOT_FOUND });
  }

  const allowedStatuses = ["delivered", "partial_returned"];
  if (!allowedStatuses.includes(order.orderStatus)) {
    throw new BadRequestError("Only delivered or partially returned orders can be returned");
  }
  if (!Array.isArray(returnItems) || returnItems.length === 0) {
    throw new BadRequestError("Return items are required");
  }

  /* ================= VALIDATE RETURN ITEMS ================= */
  const validatedItems = [];
  for (const item of returnItems) {
    const { productId, variantId, quantity, reason } = item;
    if (!productId || !variantId || !quantity || Number(quantity) <= 0) {
      throw new BadRequestError("Invalid return item data");
    }
    const orderItem = order.items.find(
      (o) =>
        o.productId?.toString() === productId?.toString() && o.variantId?.toString() === variantId?.toString()
    );
    if (!orderItem) {
      throw new NotFoundError("Product not found in order");
    }
    const availableQuantity = Number(orderItem.quantity) - Number(orderItem.returnedQuantity || 0);

    if (Number(quantity) > availableQuantity) {
      throw new BadRequestError(`Return quantity exceeds available quantity for ${orderItem.productName}`);
    }

    if (orderItem.price == null || Number(orderItem.price) <= 0) {
      throw new BadRequestError(`Invalid price found in order for ${orderItem.productName}`);
    }

    validatedItems.push({
      productId,
      variantId,
      quantity: Number(quantity),
      price: Number(orderItem.price),
      reason: reason || null,
    });
  }

  /* ================= CREATE RETURN REQUEST ================= */
  const newRequestId = uuidv6();

  order.returnRequests.push({
    requestId: newRequestId,
    items: validatedItems,
    status: "pending",
    requestedAt: new Date(),
  });

  await order.save();

  /* ---------- NOTIFICATION (once, not per item) ---------- */
  try {
    await sendNotification({
      sender: currentUser._id,
      permission: "update_stock",
      title: "New Return Request",
      message: `Return request submitted for order ${order.orderId}`,
      type: "RETURN_REQUEST_CREATED",
      entityId: order._id,
      entityModel: "Order",
      metadata: {
        orderId: order.orderId,
        requestId: newRequestId,
        totalItems: validatedItems.length,
      },
    });
  } catch (err) {
    logger.error("Notification failed on return request create", { error: err.message });
  }

  /* ================= EMAIL (background, non-blocking) ================= */
  sendReturnRequestEmails(order, validatedItems).catch((err) => {
    logger.error("Email background job failed", { error: err.message });
  });

  return {
    orderId: order.orderId,
    requestId: newRequestId,
  };
};

const sendReturnRequestEmails = async (order, validatedItems) => {
  try {
    const employees = await Employee.find({
      permissions: { $in: ["update_stock"] },
      isActive: true,
    });

    if (!employees || employees.length === 0) {
      logger.debug("No stock employees found");
      return;
    }

    const itemsHtml = validatedItems
      .map(
        (i) =>
          `<li>Product ${i.productId} / Variant ${i.variantId} — Qty ${i.quantity}${i.reason ? ` (${i.reason})` : ""}</li>`
      )
      .join("");

    const emailHtml = `
      <p>A new return request has been submitted for order <b>${order.orderId}</b>
      by ${order.user?.name || "Customer"}.</p>
      <ul>${itemsHtml}</ul>
    `;

    for (const emp of employees) {
      try {
        await sendZohoMail(emp.email, `New Return Request - ${order.orderId}`, emailHtml);
      } catch (err) {
        logger.error(`Failed email to ${emp.email}`, { error: err.message });
      }
    }
  } catch (err) {
    logger.error("Error fetching employees", { error: err.message });
  }
};

/**
 * Update pending return request.
 *
 * @param {*} data
 * @param {*} currentUser
 * @returns {Promise<*>}
 * @throws {UnauthorizedError} 401 when the caller is not logged in or the credentials are wrong.
 * @throws {NotFoundError} 404 when a record does not exist.
 * @throws {BadRequestError} 400 when the input breaks a rule.
 */
export const updatePendingReturnRequestService = async (data, currentUser) => {
  const { orderId, requestId, returnItems } = data;

  if (!currentUser?._id) {
    throw new UnauthorizedError("Unauthorized user");
  }

  /* ================= FIND ORDER (ownership enforced) ================= */
  const order = await Order.findOne({ orderId, user: currentUser._id });
  if (!order) {
    throw new NotFoundError("Order not found", { code: ERROR_CODES.ORDER_NOT_FOUND });
  }

  /* ================= FIND RETURN REQUEST ================= */
  const returnRequest = order.returnRequests.find((r) => r.requestId?.toString() === requestId?.toString());
  if (!returnRequest) {
    throw new NotFoundError("Return request not found");
  }
  if (returnRequest.status !== "pending") {
    throw new BadRequestError("Only pending requests can be updated");
  }
  if (!Array.isArray(returnItems)) {
    throw new BadRequestError("returnItems must be an array");
  }

  /* ================= VALIDATE ITEMS ================= */
  const validatedItems = [];
  for (const item of returnItems) {
    const { productId, variantId, quantity, reason } = item;
    if (!productId || !variantId || !quantity || Number(quantity) <= 0) {
      throw new BadRequestError("Invalid return item data");
    }
    const orderItem = order.items.find(
      (o) =>
        o.productId?.toString() === productId?.toString() && o.variantId?.toString() === variantId?.toString()
    );
    if (!orderItem) {
      throw new NotFoundError("Product not found in order");
    }
    const maxAllowedQty = Number(orderItem.quantity);
    if (Number(quantity) > maxAllowedQty) {
      throw new BadRequestError(`Return quantity exceeds ordered quantity for ${orderItem.productName}`);
    }
    if (orderItem.price == null || Number(orderItem.price) <= 0) {
      throw new BadRequestError(`Invalid price found in order for ${orderItem.productName}`);
    }
    validatedItems.push({
      productId,
      variantId,
      quantity: Number(quantity),
      price: Number(orderItem.price),
      reason: reason || null,
    });
  }

  /* ================= UPDATE / DELETE ================= */
  if (validatedItems.length === 0) {
    order.returnRequests = order.returnRequests.filter(
      (r) => r.requestId?.toString() !== requestId?.toString()
    );
  } else {
    returnRequest.items = validatedItems;
    returnRequest.updatedAt = new Date();
  }
  await order.save();

  /* ---------- NOTIFICATION (single call) ---------- */
  try {
    await sendNotification({
      sender: currentUser._id,
      permission: "update_stock",
      title: "Return Request Updated",
      message: `Return request updated for order ${order.orderId}`,
      type: "RETURN_REQUEST_UPDATED",
      entityId: order._id,
      entityModel: "Order",
      metadata: {
        orderId: order.orderId,
        requestId,
        totalItems: validatedItems.length,
      },
    });
  } catch (err) {
    logger.error("Notification failed on return request update", { error: err.message });
  }

  return {
    orderId,
    requestId,
    items: validatedItems,
  };
};

/**
 * Get all return requests.
 * @returns {Promise<*>}
 */
export const getAllReturnRequestsService = async () => {
  const orders = await Order.find({
    returnRequests: { $exists: true, $ne: [] },
  })
    .populate("user", "firstName lastName email instituteName")
    .sort({ createdAt: -1 })
    .lean();

  return {
    totalOrders: orders.length,
    orders,
  };
};

/**
 * Update return request status.
 *
 * @param {*} data
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 * @throws {ConflictError} 409 when the record already exists or was already processed.
 * @throws {BadRequestError} 400 when the input breaks a rule.
 */
export const updateReturnRequestStatusService = async (data) => {
  const { orderId, requestId, status, items, permission, userEmail } = data;

  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    /* ---------- FETCH EMPLOYEE ---------- */
    const employee = await Employee.findOne({ email: userEmail }).session(session);

    if (!employee) {
      throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
    }

    /* ---------- FETCH ORDER ---------- */
    const order = await Order.findOne({ orderId }).populate("user").session(session);

    if (!order) {
      throw new NotFoundError("Order not found", { code: ERROR_CODES.ORDER_NOT_FOUND });
    }

    /* ---------- FIND RETURN REQUEST ---------- */
    const returnRequest = order.returnRequests.find((r) => r.requestId === requestId);

    if (!returnRequest) {
      throw new NotFoundError("Return request not found");
    }

    if (returnRequest.status !== "pending") {
      throw new ConflictError("Request already processed");
    }

    const stockProducts = [];

    /* ================= APPROVED ================= */
    if (status === "approved") {
      if (!Array.isArray(items) || items.length === 0) {
        throw new BadRequestError("Approved items required");
      }

      for (const approvedItem of items) {
        const { productId, variantId, approvedQuantity } = approvedItem;

        if (!approvedQuantity || approvedQuantity <= 0) {
          throw new BadRequestError("Invalid approved quantity");
        }

        const requestedItem = returnRequest.items.find(
          (i) => i.productId == productId && i.variantId == variantId
        );

        if (!requestedItem) {
          throw new NotFoundError("Item not found in return request");
        }
        if (approvedQuantity > requestedItem.quantity) {
          throw new BadRequestError("Approved quantity exceeds requested quantity");
        }

        const orderItem = order.items.find((o) => o.productId == productId && o.variantId == variantId);

        if (!orderItem) continue;

        const alreadyReturned = orderItem.returnedQuantity || 0;
        const totalOrderedQuantity = orderItem.quantity + alreadyReturned;
        if (alreadyReturned + approvedQuantity > totalOrderedQuantity) {
          throw new BadRequestError("Return quantity exceeds allowed limit");
        }

        const product = await Product.findOne({ productId }).session(session);
        if (product) {
          if (product.stockType === "PRODUCT") {
            product.productStock += approvedQuantity;
          }
          if (product.stockType === "VARIANT") {
            const variant = product.variants.find((v) => v.variantId === variantId);
            if (variant) {
              variant.variantStock += approvedQuantity;
            }
          }
          await product.save({ session });
        }

        orderItem.returnedQuantity = (orderItem.returnedQuantity || 0) + approvedQuantity;
        orderItem.quantity -= approvedQuantity;
        if (orderItem.quantity < 0) orderItem.quantity = 0;
        stockProducts.push({ productId, variantId, quantity: approvedQuantity });
      }

      /* ---------- ORDER STATUS ---------- */
      const remainingQuantity = order.items.reduce((sum, item) => sum + item.quantity, 0);
      const returnedQuantity = order.items.reduce((sum, item) => sum + (item.returnedQuantity || 0), 0);

      if (remainingQuantity === 0 && returnedQuantity > 0) {
        order.orderStatus = "returned";
      } else if (returnedQuantity > 0) {
        order.orderStatus = "partial_returned";
      }
      if (["returned", "partial_returned"].includes(order.orderStatus)) {
        order.paymentStatus = "refund_pending";
      }

      /* ---------- STOCK AUDIT ---------- */
      if (stockProducts.length > 0) {
        await StockAuditLog.create(
          [
            {
              orderId: order.orderId,
              action: "add",
              products: stockProducts,
              time: new Date(),
            },
          ],
          { session }
        );
      }
    }

    /* ---------- UPDATE REQUEST ---------- */
    returnRequest.status = status;
    returnRequest.processedAt = new Date();
    returnRequest.processedBy = employee._id;

    await order.save({ session });

    /* ---------- PERMISSION AUDIT ---------- */
    await PermissionAudit.create(
      [
        {
          permissionAuditId: uuidv6(),
          actionBy: employee._id,
          actionByEmail: employee.email,
          actionFor: order._id,
          action: `Return request ${requestId} ${status} for order ${order.orderId}`,
          permission: permission || "update_return_request_status",
          actionType: "Update return request status",
        },
      ],
      { session }
    );
    await session.commitTransaction();
    session.endSession();

    /* ---------- NOTIFICATION (after commit, once) ---------- */
    try {
      await sendNotification({
        sender: employee._id,
        permission: "sales.order.update",
        title: `Return Request ${status === "approved" ? "Approved" : "Rejected"}`,
        message: `Return request ${requestId} was ${status} for order ${order.orderId}`,
        type: "RETURN_REQUEST_STATUS_UPDATED",
        entityId: order._id,
        entityModel: "Order",
        metadata: {
          orderId: order.orderId,
          requestId,
          status,
          processedBy: employee.email || null,
        },
      });
    } catch (err) {
      logger.error("Notification failed on return status update", { error: err.message });
    }

    return {
      orderId: order.orderId,
      requestId,
      status,
      processedAt: returnRequest.processedAt,
    };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};
