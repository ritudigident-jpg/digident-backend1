// import User from "../models/ecommarace/user.model.js";
// import Cart from "../models/ecommarace/cart.model.js";
// import Product from "../models/manage/product.model.js";
// import Coupon from "../models/manage/coupon.model.js";
// import { v6 as uuidv6 } from "uuid";
// import { getStock,resolvePrice,resolveImages  } from "../services/productResolver.service.js";
// import crypto from "crypto";
// import Order from "../models/ecommarace/order.model.js";
// import Payment from "../models/ecommarace/paymentaudit.model.js";
// import StockAuditLog from "../models/ecommarace/stockauditlog.model.js";
// import { sendZohoMail } from "./ZohoEmail/zohoMail.service.js";
// import { orderConfirmationTemplate } from "../config/templates/orderConfirmationTemplate.js";
// import {adminOrderCancelledTemplate} from "../config/templates/adminOrderCancelledTemplate.js"
// import Employee from "../models/manage/employee.model.js";
// import Razorpay from "razorpay";
// import { getPagination } from "../helpers/pagination.helper.js";
// import mongoose from "mongoose";
// import {PermissionAudit} from "../models/manage/permissionaudit.model.js";
// import { sendNotification } from "./notification.service.js";
// import {orderStatusUpdateTemplate} from "../config/templates/orderStatusUpdateTemplate.js"
// const razorpayInstance = new Razorpay({
//   key_id: process.env.RAZORPAY_KEY_ID,
//   key_secret: process.env.RAZORPAY_KEY_SECRET,
// });

// export const createOrderService = async (data, currentUser) => {
//   if (!currentUser?._id) {
//     const error = new Error("Unauthorized user");
//     error.statusCode = 401;
//     error.errorCode = "UNAUTHORIZED";
//     throw error;
//   }

//   const user = await User.findById(currentUser._id).lean();
//   if (!user) {
//     const error = new Error("User not found");
//     error.statusCode = 404;
//     error.errorCode = "USER_NOT_FOUND";
//     throw error;
//   }

//   if (!user.cart) {
//     const error = new Error("Cart is empty");
//     error.statusCode = 400;
//     error.errorCode = "CART_EMPTY";
//     throw error;
//   }

//   const cart = await Cart.findById(user.cart).lean();
//   if (!cart || !Array.isArray(cart.items) || cart.items.length === 0) {
//     const error = new Error("Cart is empty");
//     error.statusCode = 400;
//     error.errorCode = "CART_EMPTY";
//     throw error;
//   }

//   const {
//     addressId,
//     billingAddress,
//     organizationName,
//     gstNumber,
//     discount = 0,
//     shippingCharge = 0,
//     couponId,
//     gstAmount = 0,
//     gstPercentage = 0,
//     items: frontendItems,
//   } = data;

//   if (!Array.isArray(frontendItems) || frontendItems.length === 0) {
//     const error = new Error("Cart is empty or items are required");
//     error.statusCode = 400;
//     error.errorCode = "INVALID_ITEMS";
//     throw error;
//   }

//   if (!addressId) {
//     const error = new Error("addressId is required");
//     error.statusCode = 400;
//     error.errorCode = "ADDRESS_ID_REQUIRED";
//     throw error;
//   }

//   if (!billingAddress || typeof billingAddress !== "object") {
//     const error = new Error("billingAddress is required");
//     error.statusCode = 400;
//     error.errorCode = "BILLING_ADDRESS_REQUIRED";
//     throw error;
//   }

//   /* ================= ADDRESS ================= */
//   const possibleAddressSources = [
//     user.addresses,
//     user.shippingAddress,
//     user.shippingAddresses,
//     user.address,
//   ];

//   let addressList = [];

//   for (const source of possibleAddressSources) {
//     if (Array.isArray(source) && source.length > 0) {
//       addressList = source;
//       break;
//     }
//   }

//   if (
//     addressList.length === 0 &&
//     user.shippingAddress &&
//     typeof user.shippingAddress === "object" &&
//     !Array.isArray(user.shippingAddress)
//   ) {
//     addressList = [user.shippingAddress];
//   }

//   if (
//     addressList.length === 0 &&
//     user.address &&
//     typeof user.address === "object" &&
//     !Array.isArray(user.address)
//   ) {
//     addressList = [user.address];
//   }

//   if (addressList.length === 0) {
//     const error = new Error("No addresses found for user");
//     error.statusCode = 400;
//     error.errorCode = "ADDRESS_NOT_FOUND";
//     throw error;
//   }

//   const selectedAddress =
//     addressList.find(
//       (addr) => addr?.addressId?.toString() === addressId?.toString()
//     ) ||
//     addressList.find(
//       (addr) => addr?._id?.toString() === addressId?.toString()
//     ) ||
//     addressList.find(
//       (addr) => addr?.id?.toString() === addressId?.toString()
//     );

//   if (!selectedAddress) {
//     const error = new Error("Address not found");
//     error.statusCode = 404;
//     error.errorCode = "ADDRESS_NOT_FOUND";
//     throw error;
//   }

//   const shippingAddress = {
//     fullName:
//       selectedAddress.fullName ||
//       `${selectedAddress.firstName || ""} ${selectedAddress.lastName || ""}`.trim(),
//     phone: selectedAddress.phone || "",
//     street: selectedAddress.street || "",
//     area: selectedAddress.area || "",
//     city: selectedAddress.city || "",
//     state: selectedAddress.state || "",
//     country: selectedAddress.country || "",
//     pincode: selectedAddress.pincode || "",
//   };

//   if (
//     !shippingAddress.fullName ||
//     !shippingAddress.phone ||
//     !shippingAddress.street ||
//     !shippingAddress.area ||
//     !shippingAddress.city ||
//     !shippingAddress.state ||
//     !shippingAddress.country ||
//     !shippingAddress.pincode
//   ) {
//     const error = new Error("Selected address is incomplete");
//     error.statusCode = 400;
//     error.errorCode = "INVALID_ADDRESS";
//     throw error;
//   }

//   /* ================= ITEMS ================= */
//   let subtotal = 0;
//   const items = [];
//   for (const item of frontendItems) {
//     const { productId, variantId, quantity } = item;
//     if (!productId || !variantId || !quantity || Number(quantity) <= 0) {
//       const error = new Error("Invalid item data");
//       error.statusCode = 400;
//       error.errorCode = "INVALID_ITEM_DATA";
//       throw error;
//     }
//     const product = await Product.findOne({
//       productId,
//       status: "active",
//     })
//       .populate("category", "name")
//       .lean();

//     if (!product) {
//       const error = new Error(`Product unavailable: ${productId}`);
//       error.statusCode = 404;
//       error.errorCode = "PRODUCT_NOT_FOUND";
//       throw error;
//     }

//     if (!Array.isArray(product.variants) || product.variants.length === 0) {
//       const error = new Error(`No variants available for product: ${productId}`);
//       error.statusCode = 404;
//       error.errorCode = "VARIANTS_NOT_FOUND";
//       throw error;
//     }

//     const variant = product.variants.find(
//       (v) => v?.variantId?.toString() === variantId?.toString()
//     );

//     if (!variant) {
//       const error = new Error(`Variant unavailable: ${variantId}`);
//       error.statusCode = 404;
//       error.errorCode = "VARIANT_NOT_FOUND";
//       throw error;
//     }

//     const availableStock = getStock(product, variantId);
//     if (availableStock < Number(quantity)) {
//       const error = new Error(
//         `Only ${availableStock} item(s) available for ${product.name}`
//       );
//       error.statusCode = 400;
//       error.errorCode = "INSUFFICIENT_STOCK";
//       throw error;
//     }

//     const itemPrice = resolvePrice(product, variant);
//     if (Number.isNaN(Number(itemPrice)) || Number(itemPrice) <= 0) {
//       const error = new Error(`Invalid product price for ${product.name}`);
//       error.statusCode = 400;
//       error.errorCode = "INVALID_PRICE";
//       throw error;
//     }

//     const resolvedImages = resolveImages(product, variant);
//     const primaryImage =
//       resolvedImages?.[0]?.url ||
//       resolvedImages?.[0] ||
//       "";

//     const itemTotal = Number(itemPrice) * Number(quantity);
//     subtotal += itemTotal;

//     const attrObj = {};
//     if (Array.isArray(variant.attributes)) {
//       for (const attr of variant.attributes) {
//         if (attr?.key) {
//           attrObj[attr.key] = attr.value;
//         }
//       }
//     }

//     items.push({
//       productId,
//       variantId,
//       sku: variant.sku || product.sku || "",
//       productName: product.name || "",
//       variantName: variant.name || "",
//       categoryName: product.category?.name || "",
//       price: Number(itemPrice),
//       quantity: Number(quantity),
//       attributes: attrObj,
//       image: primaryImage,
//     });
//   }

//   /* ================= CALCULATION ================= */
//   const finalDiscount = Math.max(Number(discount) || 0, 0);
//   let finalShippingCharge = Math.max(Number(shippingCharge) || 0, 0);

//   let appliedCoupon = null;

//   if (couponId) {
//     const coupon = await Coupon.findOne({ couponId }).lean();
//     if (!coupon) {
//       const error = new Error("Invalid coupon");
//       error.statusCode = 400;
//       error.errorCode = "INVALID_COUPON";
//       throw error;
//     }

//     if (coupon.couponType === "FREESHIP") {
//       finalShippingCharge = 0;
//     }

//     appliedCoupon = {
//       couponRef: coupon._id,
//       couponId: coupon.couponId,
//       code: coupon.code,
//       couponType: coupon.couponType,
//       discountAmount: finalDiscount,
//       freeShipping: coupon.couponType === "FREESHIP",
//     };
//   }

//   const grandTotal = Math.max(
//     subtotal + finalShippingCharge - finalDiscount,
//     0
//   );

//   if (grandTotal <= 0) {
//     const error = new Error("Invalid order amount");
//     error.statusCode = 400;
//     error.errorCode = "INVALID_ORDER_AMOUNT";
//     throw error;
//   }

//   /* ================= ORDER ITEM ================= */
//   const orderItem = {
//     orderId: `ORD-${uuidv6()}`,
//     user: user._id,
//     items,
//     shippingCharge: finalShippingCharge,
//     grandTotal,
//     coupon: appliedCoupon,
//     billingAddress: {
//       fullName: billingAddress.fullName,
//       phone: billingAddress.phone,
//       street: billingAddress.street,
//       area: billingAddress.area,
//       city: billingAddress.city,
//       state: billingAddress.state,
//       country: billingAddress.country,
//       pincode: billingAddress.pincode,
//     },
//     shippingAddress,
//     organizationName: organizationName || null,
//     gstAmount: Number(gstAmount) || 0,
//     gstPercentage: Number(gstPercentage) || 0,
//     gstNumber: gstNumber || null,
//     paymentStatus: "pending",
//     orderStatus: "pending",
//   };

//   /* ================= RAZORPAY ================= */
//   const razorpayOrder = await razorpayInstance.orders.create({
//     amount: Math.round(grandTotal * 100),
//     currency: "INR",
//     receipt: orderItem.orderId,
//   });

//   /* ================= SAVE ORDER ================= */
//   await Order.create({
//     ...orderItem,
//     razorpayOrderId: razorpayOrder.id,
//   });

//    /* ---------- NOTIFICATION ---------- */
//     try {
//       await sendNotification({
//         sender: employee?._id,
//         permission: "sales.order.update",
//         title: "Order Created",
//         message: `New order created for ${orderItem.orderId}`,
//         type: "ORDER_CREATED",
//         entityId: orderItem.orderId,
//         entityModel: "Order",
//         metadata: {
//           orderId: orderItem.orderId,
//           title: orderItem.title,
//           slug: orderItem.slug,
//           createdBy: employee?.email || null,
//         },
//       });
//     } catch (err) {
//       console.error("Notification failed on create order:", err.message);
//     }

//   return {
//     razorpayOrderId: razorpayOrder.id,
//     amount: razorpayOrder.amount,
//     currency: razorpayOrder.currency,
//     orderItem,
//   };
// };


// // export const createOrderService = async (data, currentUser) => {
// //   if (!currentUser?._id) {
// //     throw new Error("Unauthorized User");
// //   }
// //   const user = await User.findById(currentUser._id);
// //   if (!user) {
// //     throw new Error("User not found");
// //   }
// //   if (!user.cart) {
// //     throw new Error("Cart is empty");
// //   }
// //   const cart = await Cart.findById(user.cart);
// //   if (!cart || cart.items.length === 0) {
// //     throw new Error("Cart is empty");
// //   }
// //   const {
// //     addressId,
// //     billingAddress,
// //     organizationName,
// //     gstNumber,
// //     discount = 0,
// //     shippingCharge = 0,
// //     couponId,
// //     gstAmount = 0,
// //     gstPercentage = 0,
// //     items: frontendItems,
// //   } = data;
// //   if(!Array.isArray(frontendItems) || frontendItems.length === 0){
// //     throw new Error("Cart is empty or Items are required");
// //   }
// //   if(!addressId || !billingAddress){
// //     throw new Error("Address fields missing");
// //   }
// //   /* ================= ADDRESS ================= */
// //   const selectedAddress = user.shippingAddress.find(
// //     (addr) => addr.addressId.toString() === addressId.toString()
// //   );
// //   if (!selectedAddress) {
// //     throw new Error("Address not found");
// //   }
// //   const shippingAddress = {
// //     fullName: `${selectedAddress.firstName} ${selectedAddress.lastName || ""}`.trim(),
// //     phone: selectedAddress.phone,
// //     street: selectedAddress.street,
// //     area: selectedAddress.area,
// //     city: selectedAddress.city,
// //     state: selectedAddress.state,
// //     country: selectedAddress.country,
// //     pincode: selectedAddress.pincode,
// //   };
// //   /* ================= ITEMS ================= */
// //   let subtotal = 0;
// //   let items = [];
// //   for(const item of frontendItems){
// //     const { productId, variantId, quantity } = item;
// //     if (!productId || !variantId || !quantity) {
// //       throw new Error("Invalid item data");
// //     }
// //     const product = await Product.findOne({
// //       productId,
// //       status: "active",
// //     }).populate("category", "name");

// //     if (!product) {
// //       throw new Error(`Product unavailable: ${productId}`);
// //     }
// //     const variant = product.variants.find(
// //       (v) => v.variantId === variantId
// //     );
// //     if (!variant) {
// //       throw new Error(`Variant unavailable: ${variantId}`);
// //     }
// //     const availableStock = getStock(product, variantId);
// //     if(availableStock < quantity){
// //       throw new Error(
// //         `Only ${availableStock} item(s) available for ${product.name}`
// //       );
// //     }
// //     const itemPrice = variant.price;
// //     if (!itemPrice || itemPrice <= 0) {
// //       throw new Error("Invalid product price");
// //     }
// //     const itemTotal = itemPrice * quantity;
// //     subtotal += itemTotal;
// //     const attrObj = {};
// //     if (Array.isArray(variant.attributes)) {
// //       variant.attributes.forEach((attr) => {
// //         attrObj[attr.key] = attr.value;
// //       });
// //     }
// //     items.push({
// //       productId,
// //       variantId,
// //       sku: variant.sku || product.sku || "",
// //       productName: product.name,
// //       variantName: variant.name || "",
// //       categoryName: product.category?.name || "",
// //       price: itemPrice,
// //       quantity,
// //       attributes: attrObj,
// //       image: variant?.variantImages?.[0] || product?.images?.[0],
// //     });
// //   }

// //   /* ================= CALCULATION ================= */
// //   const finalDiscount = Math.max(Number(discount), 0);
// //   const finalShippingCharge = Math.max(Number(shippingCharge), 0);

// //   const grandTotal = Math.max(
// //     subtotal + finalShippingCharge - finalDiscount,
// //     0
// //   );
// //   /* ================= COUPON ================= */
// //   let appliedCoupon = null;
// //   if (couponId) {
// //     const coupon = await Coupon.findOne({ couponId });
// //     if (!coupon) {
// //       throw new Error("Invalid coupon");
// //     }
// //     appliedCoupon = {
// //       couponRef: coupon._id,
// //       couponId: coupon.couponId,
// //       code: coupon.code,
// //       couponType: coupon.couponType,
// //       discountAmount: finalDiscount,
// //       freeShipping: coupon.couponType === "FREESHIP",
// //     };
// //   }
// //   /* ================= ORDER ================= */
// //   const orderItem = {
// //     orderId: `ORD-${uuidv6()}`,
// //     user: user._id,
// //     items,
// //     shippingCharge: finalShippingCharge,
// //     grandTotal,
// //     coupon: appliedCoupon,
// //     billingAddress,
// //     shippingAddress,
// //     organizationName: organizationName || null,
// //     gstAmount,
// //     gstPercentage,
// //     gstNumber: gstNumber || null,
// //     paymentStatus: "pending",
// //     orderStatus: "pending",
// //   };
// //   /* ================= RAZORPAY ================= */
// //   const razorpayOrder = await razorpayInstance.orders.create({
// //     amount: Math.round(grandTotal * 100),
// //     currency: "INR",
// //     receipt: orderItem.orderId,
// //   });
// //   return {
// //     razorpayOrderId: razorpayOrder.id,
// //     amount: razorpayOrder.amount,
// //     currency: razorpayOrder.currency,
// //     orderItem,
// //   };
// // };

// export const verifyRazorpayService = async (data, currentUser) => {
//   const {
//     razorpay_order_id,
//     razorpay_payment_id,
//     razorpay_signature,
//     orderItem,
//   } = data;

//   /* ================= VALIDATION ================= */
//   if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
//     throw new Error("Missing payment details");
//   }

//   if (!orderItem?.orderId) {
//     throw new Error("Invalid order data");
//   }

//   if (!currentUser?._id) {
//     throw new Error("Unauthorized user");
//   }

//   /* ================= VERIFY SIGNATURE ================= */
//   const body = `${razorpay_order_id}|${razorpay_payment_id}`;
//   const expectedSignature = crypto
//     .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
//     .update(body)
//     .digest("hex");

//   if (expectedSignature !== razorpay_signature) {
//     throw new Error("Invalid Razorpay signature");
//   }

//   /* ================= USER ================= */
//   const user = await User.findById(currentUser._id);
//   if (!user) {
//     throw new Error("User not found");
//   }

//   /* ================= FIND EXISTING ORDER ================= */
//   const order = await Order.findOne({
//     orderId: orderItem.orderId,
//     user: currentUser._id,
//     razorpayOrderId: razorpay_order_id,
//   });

//   if (!order) {
//     throw new Error("Order not found");
//   }

//   /* ================= PREVENT DOUBLE PAYMENT PROCESS ================= */
//   if (order.paymentStatus === "paid") {
//     throw new Error("Order is already paid");
//   }

//   /* ================= PAYMENT ================= */
//   await Payment.create({
//     paymentId: uuidv6(),
//     order: order.orderId,
//     user: user._id,
//     razorpayOrderId: razorpay_order_id,
//     razorpayPaymentId: razorpay_payment_id,
//     razorpaySignature: razorpay_signature,
//     amount: order.grandTotal,
//     status: "success",
//   });

//   /* ================= UPDATE ORDER ================= */
//   order.razorpayPaymentId = razorpay_payment_id;
//   order.razorpaySignature = razorpay_signature;
//   order.paymentStatus = "paid";
//   order.orderStatus = "placed";
//   order.paidAt = new Date();

//   await order.save();

//   const lowStockProducts = [];
//   const deductedProducts = [];

//   /* ================= STOCK DEDUCTION ================= */
//   for (const item of order.items) {
//     const product = await Product.findOne({
//       productId: item.productId,
//       status: "active",
//     });

//     if (!product) {
//       throw new Error(`Product not found: ${item.productId}`);
//     }

//     const variant = product.variants.find(
//       (v) => v.variantId === item.variantId
//     );

//     if (!variant) {
//       throw new Error(`Variant not found: ${item.variantId}`);
//     }

//     if (product.stockType === "PRODUCT") {
//       product.productStock -= item.quantity;

//       if (product.productStock < 50) {
//         lowStockProducts.push({
//           productName: product.name,
//           variantName: "-",
//           stockLeft: product.productStock,
//         });
//       }
//     } else {
//       variant.variantStock -= item.quantity;

//       if (variant.variantStock < 50) {
//         lowStockProducts.push({
//           productName: product.name,
//           variantName: variant.name,
//           stockLeft: variant.variantStock,
//         });
//       }
//     }

//     deductedProducts.push({
//       productId: item.productId,
//       variantId: item.variantId,
//       quantity: item.quantity,
//     });

//     await product.save();
//   }

//   /* ================= STOCK LOG ================= */
//   if (deductedProducts.length > 0) {
//     await StockAuditLog.create({
//       orderId: order.orderId,
//       action: "deduct",
//       products: deductedProducts,
//     });
//   }

//   /* ================= CLEAR CART ================= */
//   await Cart.findByIdAndUpdate(user.cart, {
//     $set: { items: [] },
//   });

//   user.orderHistory.push({ orderId: order._id });
//   await user.save();


// /* ================= SEND NOTIFICATION ================= */
// await sendNotification({
//   permission: "order.listing.read",

//   title: "New Order Placed",

//   message: `Order ${order.orderId} has been placed successfully`,

//   type: "ORDER_PLACED",

//   entityId: order._id,
//   entityModel: "Order",

//   metadata: {
//     orderId: order.orderId,
//     customerName: `${user.firstName} ${user.lastName}`,
//     customerEmail: user.email,
//     paymentId: razorpay_payment_id,
//     paymentStatus: order.paymentStatus,
//     orderStatus: order.orderStatus,
//     totalAmount: order.grandTotal,
//     totalItems: order.items.length,
//   },
// });

//   /* ================= EMAIL ================= */
//   try {
//     const emailHtml = orderConfirmationTemplate(
//       user.firstName,
//       order.orderId,
//       order.grandTotal,
//       order.items
//     );

//     await sendZohoMail(
//       user.email,
//       "Payment Successful - Order Confirmed",
//       emailHtml
//     );

//     await sendLowStockAlertToAdmins(lowStockProducts);
//   } catch (err) {
//     console.log("EMAIL ERROR:", err.message);
//   }

//   return order;
// };

// export const getUserOrdersService = async (query, currentUser) => {
//   if (!currentUser?._id) {
//     throw new Error("Unauthorized user");
//   }
//   // /* ---------- PAGINATION ---------- */
//   // const page = Math.max(parseInt(query.page) || 1, 1);
//   // const limit = Math.max(parseInt(query.limit) || 10, 1);
//   // const skip = (page - 1) * limit;
//   /* ---------- FILTER ---------- */
//   const { month, year } = query;
//   const filter = { user: currentUser._id };
//   if (month && year) {
//     const m = Number(month);
//     const y = Number(year);
//     if (isNaN(m) || isNaN(y) || m < 1 || m > 12 || y < 2000) {
//       throw new Error("Invalid month or year");
//     }
//     filter.createdAt = {
//       $gte: new Date(y, m - 1, 1),
//       $lt: new Date(y, m, 1),
//     };
//   }

//   /* ---------- QUERY ---------- */
//   const [orders, total] = await Promise.all([
//     Order.find(filter)
//       .sort({ createdAt: -1 })
//       .lean(),
//     Order.countDocuments(filter),
//   ]);
//   // /* ---------- PAGINATION RESPONSE ---------- */
//   // const pagination = getPagination({
//   //   total,
//   //   page,
//   //   limit,
//   // });

//   return {
//     filters: {
//       month: month || null,
//       year: year || null,
//     },
//     orders,
//   };
// };

// export const getSingleOrderService = async (orderId, currentUser) => {
//   if (!currentUser?._id) {
//     throw new Error("Unauthorized user");
//   }

//   if (!orderId) {
//     throw new Error("orderId is required");
//   }

//   const order = await Order.findOne({
//     orderId,
//     user: currentUser._id,
//   }).lean();

//   if (!order) {
//     throw new Error("Order not found");
//   }

//   return order;
// };

// export const cancelOrderService = async (orderId, currentUser, reason) => {
//   const session = await mongoose.startSession();
//   session.startTransaction();

//   try {
//     if (!currentUser?._id) {
//       throw new Error("Unauthorized user");
//     }

//     if (!orderId) {
//       throw new Error("orderId is required");
//     }

//     const order = await Order.findOne({ orderId, user: currentUser._id }).session(session);

//     if (!order) {
//       throw new Error("Order not found");
//     }

//     const nonCancellableStates = ["delivered", "cancelled", "shipped"];
//     if (nonCancellableStates.includes(order.orderStatus)) {
//       throw new Error(`Order cannot be cancelled once ${order.orderStatus}`);
//     }

//     // ----------------------------
//     // RESTORE STOCK IF PAID
//     // ----------------------------
//     let restoredProducts = [];

//     if (order.paymentStatus === "paid") {
//       for (const item of order.items) {
//         const product = await Product.findOne({ productId: item.productId, status: "active" }).session(session);

//         if (!product) throw new Error(`Product not found: ${item.productName}`);

//         if (product.stockType === "PRODUCT") {
//           product.productStock += item.quantity;
//         } else if (product.stockType === "VARIANT") {
//           const variant = product.variants.find(v => v.variantId === item.variantId);
//           if (!variant) throw new Error(`Variant not found: ${item.variantName}`);
//           variant.variantStock += item.quantity;
//         }

//         restoredProducts.push({ productId: item.productId, variantId: item.variantId, quantity: item.quantity });
//         await product.save({ session });
//       }

//       if (restoredProducts.length > 0) {
//         await StockAuditLog.create(
//           [{ orderId: order.orderId, action: "add", products: restoredProducts }],
//           { session }
//         );
//       }
//     }

//     // ----------------------------
//     // CANCEL ORDER
//     // ----------------------------
//     const cancelledAt = new Date();

//     order.orderStatus = "cancelled";
//     order.cancellationReason = reason?.trim() || "Cancelled by user";

//     if (order.paymentStatus === "paid") {
//       order.paymentStatus = "refund_pending";
//       order.refundAmount = order.grandTotal;
//     }

//     order.cancelledAt = cancelledAt;

//     await order.save({ session });
//     await session.commitTransaction();
//     session.endSession();

//     // ----------------------------
//     // ADMIN EMAIL AFTER COMMIT
//     // ----------------------------
//     try {
//       const customerName = currentUser.firstName || currentUser.lastName
//         ? `${currentUser.firstName || ""} ${currentUser.lastName || ""}`.trim()
//         : currentUser.name || currentUser.email || "Customer";

//       const emailHtml = adminOrderCancelledTemplate(
//         order.orderId,
//         customerName,
//         currentUser.email,
//         order.refundAmount,
//         order.paymentStatus,
//         order.cancellationReason,
//         cancelledAt.toLocaleString()
//       );

//       await sendZohoMail(process.env.ADMIN_EMAIL, `Order Cancelled: ${order.orderId}`, emailHtml);
//     } catch (err) {
//       console.error("Admin email failed:", err.message);
//     }
//     /* ----------------------------
//    SEND NOTIFICATION
// ---------------------------- */
//  /* ---------- NOTIFICATION ---------- */
//   try {
//     await sendNotification({
//       sender: employee?._id,
//       permission: "sales.order.update",
//       title: "cancelled Order",
//       message: `Order ${order.orderId} has been cancelled`,
//       type: "ORDER_CANCELLED",
//       entityId: order._id,
//       entityModel: "Order",
//       metadata: {
//         orderId: order.orderId,
//         title: order.title,
//         slug: order.slug,
//         createdBy: employee?.email || null,
//       },
//     });
//   } catch (err) {
//     console.error("Notification failed on create job:", err.message);
//   }

//     return {
//       orderId: order.orderId,
//       orderStatus: order.orderStatus,
//       paymentStatus: order.paymentStatus,
//       refundAmount: order.refundAmount || 0,
//       cancelledAt,
//       cancellationReason: order.cancellationReason,
//     };
//   } catch (error) {
//     await session.abortTransaction();
//     session.endSession();
//     throw error;
//   }
// };

// export const markRefundCompletedService = async (orderId) => {
//   const order = await Order.findOne({ orderId });
//   if (!order) throw Object.assign(new Error("Order not found"), { statusCode: 404 });
//   if (order.orderStatus !== "cancelled") throw Object.assign(new Error("Order is not cancelled"), { statusCode: 400 });
//   if (order.paymentStatus === "refunded") throw Object.assign(new Error("Refund already completed"), { statusCode: 400 });
//   if (order.paymentStatus !== "refund_pending") throw Object.assign(new Error("Refund not in pending state"), { statusCode: 400 });
//   if (!order.razorpayPaymentId) throw Object.assign(new Error("Razorpay paymentId not found"), { statusCode: 400 });
//   if (!order.refundAmount || order.refundAmount <= 0) throw Object.assign(new Error("Invalid refund amount"), { statusCode: 400 });
//   // Process Razorpay refund
//   const refund = await razorpayInstance.payments.refund(order.razorpayPaymentId, {
//     amount: Math.round(order.refundAmount * 100),
//     speed: "normal",
//     notes: {
//       orderId: order.orderId,
//       reason: order.cancellationReason || "Order cancelled refund",
//     },
//   });

//   // Update order after refund
//   order.paymentStatus = "refunded";
//   order.refundedAt = new Date();
//   order.razorpayRefundId = refund.id;
//   order.refundHistory = order.refundHistory || [];
//   order.refundHistory.push({
//     refundId: refund.id,
//     amount: order.refundAmount,
//     status: refund.status || "processed",
//     refundedAt: new Date(),
//   });

//   await order.save();
//    /* ---------- NOTIFICATION ---------- */
//     try {
//       await sendNotification({
//         sender: employee?._id,
//         permission: "sales.order.update",
//         title: "Order Refunded",
//         message: `Refund completed for order ${order.orderId}`,
//         type: "ORDER_REFUNDED",
//         entityId: order._id,
//         entityModel: "Order",
//         metadata: {
//           orderId: order.orderId,
//           title: order.title,
//           slug: order.slug,
//           createdBy: employee?.email || null,
//         },
//       });
//     } catch (err) {
//       console.error("Notification failed on create job:", err.message);
//     }

//   return {
//     orderId: order.orderId,
//     orderStatus: order.orderStatus,
//     paymentStatus: order.paymentStatus,
//     refundAmount: order.refundAmount,
//     refundedAt: order.refundedAt,
//     razorpayRefundId: refund.id,
//     razorpayRefundStatus: refund.status,
//   };
// };

// export const updateOrderStatusService = async (data, currentUser) => {
//   const { orderId, status, permission } = data;

//   /* ---------- AUTH ---------- */
//   const employee = await Employee.findOne({ email: currentUser.email });
//   if (!employee) {
//     const err = new Error("Employee not found");
//     err.statusCode = 404;
//     throw err;
//   }

//   /* ---------- FETCH ORDER ---------- */
//   const order = await Order.findOne({ orderId }).populate("user");
//   if (!order) {
//     const err = new Error("Order not found");
//     err.statusCode = 404;
//     throw err;
//   }

//   const currentStatus = order.orderStatus;

//   /* ---------- FINAL STATE CHECK ---------- */
//   if (["cancelled", "returned"].includes(currentStatus)) {
//     const err = new Error(
//       `Order cannot be updated because it is already ${currentStatus}`
//     );
//     err.statusCode = 400;
//     throw err;
//   }

//   /* ---------- STATUS FLOW ---------- */
//   const statusFlow = {
//     placed: ["packed", "confirmed", "shipped"],
//     packed: ["confirmed", "shipped"],
//     confirmed: ["shipped"],
//     shipped: ["delivered"],
//   };

//   if (currentStatus === status) {
//     const err = new Error(`Order already in status ${status}`);
//     err.statusCode = 400;
//     throw err;
//   }

//   const allowedNextStatuses = statusFlow[currentStatus] || [];

//   if (!allowedNextStatuses.includes(status)) {
//     const err = new Error(
//       `Invalid status update: cannot change from "${currentStatus}" to "${status}"`
//     );
//     err.statusCode = 400;
//     throw err;
//   }

//   /* ---------- ATOMIC UPDATE ---------- */
//   const updateData = {
//     orderStatus: status,
//     statusUpdatedAt: new Date(),
//   };

//   if (status === "delivered") {
//     updateData.paymentStatus = "paid";
//     updateData.paidAt = new Date();
//   }

//   const updatedOrder = await Order.findOneAndUpdate(
//     { orderId, orderStatus: currentStatus },
//     { $set: updateData },
//     { new: true }
//   ).populate("user");

//   if (!updatedOrder) {
//     const err = new Error(
//       "Order was modified by another process. Please retry."
//     );
//     err.statusCode = 409;
//     throw err;
//   }

//   /* ---------- EMAIL (NON-BLOCKING) ---------- */
//   try {
//     const emailHtml = orderStatusUpdateTemplate(
//       updatedOrder.user?.name || "Customer",
//       updatedOrder.orderId,
//       status
//     );

//     await sendZohoMail(
//       updatedOrder.user?.email,
//       `Order Update: ${updatedOrder.orderId}`,
//       emailHtml
//     );
//   } catch (emailError) {
//     console.log("Failed to send order status update email:", emailError.message);
//   }

//   /* ---------- AUDIT LOG ---------- */
//   await PermissionAudit.create({
//     permissionAuditId: uuidv6(),
//     actionBy: employee._id,
//     actionByEmail: employee.email,
//     actionFor: updatedOrder._id,
//     actionForEmail: updatedOrder.user?.email,
//     permission: permission || "update_order_status",
//     action: "update",
//     meta: {
//       from: currentStatus,
//       to: status,
//     },
//   });

//    /* ---------- NOTIFICATION ---------- */
//     try {
//       await sendNotification({
//         sender: employee?._id,
//         permission: permission || "update_order_status",
//         title: "Order Status Updated",
//         message: `Order status updated to ${status} for ${updatedOrder.orderId}`,
//         type: "ORDER_STATUS_UPDATED",
//         entityId: updatedOrder._id,
//         entityModel: "Order",
//         metadata: {
//           orderId: updatedOrder.orderId,
//           title: updatedOrder.title,
//           slug: updatedOrder.slug,
//           createdBy: employee?.email || null,
//         },
//       });
//     } catch (err) {
//       console.error("Notification failed on order status update:", err.message);
//     }
//   return {
//     orderId: updatedOrder.orderId,
//     oldStatus: currentStatus,
//     newStatus: status,
//     paymentStatus: updatedOrder.paymentStatus,
//     statusUpdatedAt: updatedOrder.statusUpdatedAt,
//   };
// };

// export const getOrdersByStatusService = async (data) => {
//   const { status, page, limit } = data;

//   const skip = (page - 1) * limit;

//   /* ---------- QUERY ---------- */
//   const [orders, total] = await Promise.all([
//     Order.find({ orderStatus: status })
//       .sort({ createdAt: -1 })
//       .skip(skip)
//       .limit(limit)
//       .lean(),

//     Order.countDocuments({ orderStatus: status }),
//   ]);

//   return {
//     orders,
//     pagination: {
//       total,
//       page,
//       limit,
//       totalPages: Math.ceil(total / limit),
//     },
//   };
// };

// export const getAllOrdersAdminService = async ({ page, limit }) => {
//   const skip = (page - 1) * limit;
//   const [orders, total] = await Promise.all([
//     Order.find()
//       .sort({ createdAt: -1 })
//       .skip(skip)
//       .limit(limit)
//       .lean(),
//     Order.countDocuments(),
//   ]);
//   return {
//     orders,
//     pagination: getPagination({ total, page, limit }),
//   };
// };

// export const getAllOrdersService = async ({ page, limit }) => {
//   const skip = (page - 1) * limit;

//   const [orders, total] = await Promise.all([
//     Order.find()
//       .sort({ createdAt: -1 })
//       .skip(skip)
//       .limit(limit)
//       .lean(),

//     Order.countDocuments(),
//   ]);

//   return {
//     orders,
//     pagination: getPagination({ total, page, limit }),
//   };
// };

// export const markRefundCompleteAdminService = async (
//   { orderId, amount },
//   currentUser
// ) => {
//   const session = await mongoose.startSession();
//   session.startTransaction();

//   try {
//     /* ---------- EMPLOYEE ---------- */
//     const employee = await Employee.findOne({
//       email: currentUser.email,
//     }).session(session);

//     if (!employee) {
//       const err = new Error("Employee not found");
//       err.statusCode = 404;
//       throw err;
//     }

//     /* ---------- ORDER ---------- */
//     const order = await Order.findOne({ orderId }).session(session);

//     if (!order) {
//       const err = new Error("Order not found");
//       err.statusCode = 404;
//       throw err;
//     }

//     /* ---------- STATUS VALIDATION ---------- */
//     if (!["returned", "partial_returned"].includes(order.orderStatus)) {
//       const err = new Error(
//         `Order is not eligible for refund. Current status: ${order.orderStatus}`
//       );
//       err.statusCode = 400;
//       throw err;
//     }

//     if (
//       !["refund_pending", "partial_refunded"].includes(order.paymentStatus)
//     ) {
//       const err = new Error(
//         `Refund not allowed. Current paymentStatus: ${order.paymentStatus}`
//       );
//       err.statusCode = 400;
//       throw err;
//     }

//     if (!order.razorpayPaymentId) {
//       const err = new Error("Razorpay paymentId not found");
//       err.statusCode = 400;
//       throw err;
//     }

//     /* ---------- RAZORPAY FETCH ---------- */
//     const paymentDetails = await razorpayInstance.payments.fetch(
//       order.razorpayPaymentId
//     );

//     const totalPaidAmount = paymentDetails.amount / 100;

//     const alreadyRefundedAmount = order.partialRefundAmount || 0;
//     const remainingRefundableAmount =
//       totalPaidAmount - alreadyRefundedAmount;

//     if (remainingRefundableAmount <= 0) {
//       const err = new Error("No refundable amount left");
//       err.statusCode = 400;
//       throw err;
//     }

//     /* ---------- REFUND AMOUNT ---------- */
//     let refundAmount = remainingRefundableAmount;

//     if (amount !== undefined && amount !== null) {
//       if (typeof amount !== "number" || amount <= 0) {
//         const err = new Error("Invalid refund amount");
//         err.statusCode = 400;
//         throw err;
//       }

//       if (amount > remainingRefundableAmount) {
//         const err = new Error(
//           `Refund amount exceeds remaining refundable amount ₹${remainingRefundableAmount}`
//         );
//         err.statusCode = 400;
//         throw err;
//       }
//        /* ---------- NOTIFICATION ---------- */
//         try {
//           await sendNotification({
//             sender: employee?._id,
//             permission: "sales.order.update",
//             title: "Order Refund Updated",
//             message: `Order refund updated for ${order.orderId}`,
//             type: "ORDER_REFUND_UPDATED",
//             entityId: order._id,
//             entityModel: "Order",
//             metadata: {
//               orderId: order.orderId,
//               createdBy: employee?.email || null,
//             },
//           });
//         } catch (err) {
//           console.error("Notification failed on order refund update:", err.message);
//         }

//       refundAmount = amount;
//     }

//     /* ---------- PROCESS REFUND ---------- */
//     const refund = await razorpayInstance.payments.refund(
//       order.razorpayPaymentId,
//       {
//         amount: Math.round(refundAmount * 100),
//         notes: {
//           orderId: order.orderId,
//           refundedBy: employee.email,
//         },
//       }
//     );

//     /* ---------- UPDATE ORDER ---------- */
//     const newTotalRefunded = alreadyRefundedAmount + refundAmount;
//     const newRemainingAmount = totalPaidAmount - newTotalRefunded;

//     order.partialRefundAmount = newTotalRefunded;
//     order.remainingRefundAmount = newRemainingAmount;
//     order.paymentStatus =
//       newTotalRefunded >= totalPaidAmount
//         ? "refunded"
//         : "partial_refunded";

//     order.refundedAt = new Date();
//     order.razorpayRefundId = refund.id;

//     order.refundHistory = order.refundHistory || [];
//     order.refundHistory.push({
//       refundId: refund.id,
//       amount: refundAmount,
//       refundedBy: employee.email,
//       refundedAt: new Date(),
//       refundStatus: refund.status,
//     });

//     await order.save({ session });

//     /* ---------- AUDIT LOG (FIXED) ---------- */
//     await PermissionAudit.create(
//       [
//         {
//           permissionAuditId: uuidv6(),
//           actionBy: employee._id,
//           actionByEmail: employee.email,
//           actionFor: order._id,
//           actionForEmail: null,
//           permission: "initiate_refund",
//           action: "refund",
//           meta: {
//             orderId: order.orderId,
//             amount: refundAmount,
//           },
//         },
//       ],
//       { session }
//     );

//     await session.commitTransaction();
//     session.endSession();

//     return {
//       orderId: order.orderId,
//       orderStatus: order.orderStatus,
//       paymentStatus: order.paymentStatus,
//       totalPaidAmount,
//       totalRefundedAmount: newTotalRefunded,
//       remainingRefundableAmount: newRemainingAmount,
//       refundedNow: refundAmount,
//       refundedAt: order.refundedAt,
//       razorpayRefundId: refund.id,
//       refundHistory: order.refundHistory,
//     };
//   } catch (error) {
//     await session.abortTransaction();
//     session.endSession();
//     throw error;
//   }
// };

// export const salesDashboardService = async (data) => {
//   const { startDate, endDate, country, state, top } = data;

//   /* ---------- SAFE LIMIT ---------- */
//   const safeTop = Math.min(parseInt(top) || 10, 50);

//   /* ---------- BASE MATCH ---------- */
//   const baseMatch = {
//     orderStatus: { $nin: ["cancelled", "returned"] },
//   };

//   /* ---------- DATE FILTER ---------- */
//   if (startDate || endDate) {
//     baseMatch.createdAt = {};

//     if (startDate) {
//       baseMatch.createdAt.$gte = new Date(
//         `${startDate}T00:00:00.000Z`
//       );
//     }

//     if (endDate) {
//       baseMatch.createdAt.$lte = new Date(
//         `${endDate}T23:59:59.999Z`
//       );
//     }
//   }

//   /* ---------- LOCATION FILTER ---------- */
//   if (country) {
//     baseMatch["shippingAddress.country"] = country;
//   }

//   if (state) {
//     baseMatch["shippingAddress.state"] = state;
//   }

//   /* ---------- GROUP LEVEL ---------- */
//   let groupField;
//   let level;

//   if (!country && !state) {
//     groupField = "$shippingAddress.country";
//     level = "country";
//   } else if (country && !state) {
//     groupField = "$shippingAddress.state";
//     level = "state";
//   } else {
//     groupField = "$shippingAddress.city";
//     level = "city";
//   }

//   /* ---------- AGGREGATION ---------- */
//   const result = await Order.aggregate([
//     { $match: baseMatch },
//     {
//       $addFields: {
//         netRevenue: {
//           $subtract: [
//             "$grandTotal",
//             { $ifNull: ["$partialRefundAmount", 0] },
//           ],
//         },
//       },
//     },
//     {
//       $group: {
//         _id: groupField,
//         totalRevenue: { $sum: "$netRevenue" },
//         totalOrders: { $sum: 1 },
//       },
//     },
//     { $sort: { totalRevenue: -1 } },
//     { $limit: safeTop },
//   ]);

//   /* ---------- FORMAT ---------- */
//   const analytics = result.map((item) => ({
//     name: item._id || "Unknown",
//     totalRevenue: item.totalRevenue,
//     totalOrders: item.totalOrders,
//     averageOrderValue: item.totalOrders
//       ? +(item.totalRevenue / item.totalOrders).toFixed(2)
//       : 0,
//   }));

//   return {
//     level,
//     filters: {
//       startDate,
//       endDate,
//       country,
//       state,
//     },
//     analytics,
//   };
// };

// // export const createReturnRequestService = async (data) => {
// //   const { orderId, returnItems } = data;

// //   /* ================= FIND ORDER ================= */

// //   const order = await Order.findOne({ orderId }).populate("user");

// //   if (!order) {
// //     throw new Error("Order not found");
// //   }

// //   const allowedStatuses = ["delivered", "partially_returned"];

// //   if (!allowedStatuses.includes(order.orderStatus)) {
// //     throw new Error(
// //       "Only delivered or partially returned orders can be returned"
// //     );
// //   }

// //   /* ================= VALIDATE RETURN ITEMS ================= */

// //   const validatedItems = [];

// //   for (const item of returnItems) {
// //     const { productId, variantId, quantity, reason } = item;

// //     if (!productId || !variantId || !quantity || quantity <= 0) {
// //       throw new Error("Invalid return item data");
// //     }

// //     const orderItem = order.items.find(
// //       (o) =>
// //         o.productId === productId &&
// //         o.variantId === variantId
// //     );

// //     if (!orderItem) {
// //       throw new Error("Product not found in order");
// //     }

// //     /* ---------- AVAILABLE QUANTITY ---------- */

// //     const availableQuantity =
// //       orderItem.quantity - (orderItem.returnedQuantity || 0);

// //     if (quantity > availableQuantity) {
// //       throw new Error(
// //         `Return quantity exceeds available quantity for ${orderItem.productName}`
// //       );
// //     }

// //     validatedItems.push({
// //       productId,
// //       variantId,
// //       quantity,
// //       reason: reason || null,
// //     });
// //   }

// //   /* ================= CREATE RETURN REQUEST ================= */

// //   const newRequestId = uuidv6();

// //   order.returnRequests.push({
// //     requestId: newRequestId,
// //     items: validatedItems,
// //     status: "pending",
// //     requestedAt: new Date(),
// //   });

// //   await order.save();

// //   /* ================= BACKGROUND EMAIL ================= */

// //   sendReturnRequestEmails(order, validatedItems).catch((err) => {
// //     console.error("Email background job failed:", err.message);
// //   });

// //   return {
// //     orderId: order.orderId,
// //     requestId: newRequestId,
// //   };
// // };

// export const createReturnRequestService = async (data) => {
//   const { orderId, returnItems } = data;
//   /* ================= FIND ORDER ================= */
//   const order = await Order.findOne({ orderId }).populate("user");
//   if (!order) {
//     throw new Error("Order not found");
//   }
//   const allowedStatuses = ["delivered", "partial_returned"];
//   if (!allowedStatuses.includes(order.orderStatus)) {
//     throw new Error(
//       "Only delivered or partially returned orders can be returned"
//     );
//   }
//   if (!Array.isArray(returnItems) || returnItems.length === 0) {
//     throw new Error("Return items are required");
//   }
//   /* ================= VALIDATE RETURN ITEMS ================= */
//   const validatedItems = [];
//   for (const item of returnItems) {
//     const { productId, variantId, quantity, reason } = item;
//     if (!productId || !variantId || !quantity || Number(quantity) <= 0) {
//       throw new Error("Invalid return item data");
//     }
//     const orderItem = order.items.find(
//       (o) =>
//         o.productId?.toString() === productId?.toString() &&
//         o.variantId?.toString() === variantId?.toString()
//     );
//     if (!orderItem) {
//       throw new Error("Product not found in order");
//     }
//     const availableQuantity =
//       Number(orderItem.quantity) - Number(orderItem.returnedQuantity || 0);

//     if (Number(quantity) > availableQuantity) {
//       throw new Error(
//         `Return quantity exceeds available quantity for ${orderItem.productName}`
//       );
//     }

//     if (orderItem.price == null || Number(orderItem.price) <= 0) {
//       throw new Error(`Invalid price found in order for ${orderItem.productName}`);
//     }

//          /* ---------- NOTIFICATION ---------- */
//         try {
//           await sendNotification({
//             sender: employee?._id,
//             permission: "sales.order.update",
//             title: "Refund order request",
//             message: `Order refund updated for ${order.orderId}`,
//             type: "ORDER_REFUND_UPDATED",
//             entityId: order._id,
//             entityModel: "Order",
//             metadata: {
//               orderId: order.orderId,
//               createdBy: employee?.email || null,
//             },
//           });
//         } catch (err) {
//           console.error("Notification failed on order refund update:", err.message);
//         }

//     validatedItems.push({
//       productId,
//       variantId,
//       quantity: Number(quantity),
//       price: Number(orderItem.price),
//       reason: reason || null,
//     });
//   }

//   /* ================= CREATE RETURN REQUEST ================= */
//   const newRequestId = uuidv6();

//   order.returnRequests.push({
//     requestId: newRequestId,
//     items: validatedItems,
//     status: "pending",
//     requestedAt: new Date(),
//   });

//   await order.save();

//   /* ================= EMAIL ================= */
//   sendReturnRequestEmails(order, validatedItems).catch((err) => {
//     console.error("Email background job failed:", err.message);
//   });

  
//   return {
//     orderId: order.orderId,
//     requestId: newRequestId,
//   };
// };

// const sendReturnRequestEmails = async (order, validatedItems) => {
//   try {
//     const employees = await Employee.find({
//       permissions: { $in: ["update_stock"] },
//       isActive: true,
//     });

//     if (!employees || employees.length === 0) {
//       console.log("No stock employees found");
//       return;
//     }

//     for (const emp of employees) {
//       try {
//         const emailHtml = returnStockNotificationTemplate(
//           `${emp.firstName} ${emp.lastName}`,
//           order.orderId,
//           order.user?.name || "Customer",
//           validatedItems
//         );

//         await sendZohoMail(
//           emp.email,
//           `New Return Request - ${order.orderId}`,
//           emailHtml
//         );
//         /* ================= SEND NOTIFICATION ================= */
// await sendNotification({
//   permission: "update_stock",

//   title: "Return Request Updated",

//   message: `Return request updated for order ${order.orderId}`,

//   type: "RETURN_REQUEST_UPDATED",

//   entityId: order._id,
//   entityModel: "Order",

//   metadata: {
//     orderId: order.orderId,
//     requestId,
//     customerName: order.user?.name || "Customer",
//     totalItems: validatedItems.length,
//     items: validatedItems.map((item) => ({
//       productId: item.productId,
//       variantId: item.variantId,
//       quantity: item.quantity,
//       reason: item.reason,
//     })),
//   },
// });


//       } catch (err) {
//         console.error(`Failed email to ${emp.email}:`, err.message);
//       }
//     }
//   } catch (err) {
//     console.error("Error fetching employees:", err.message);
//   }
// };

// export const updatePendingReturnRequestService = async (data) => {
//   const { orderId, requestId, returnItems } = data;
//   /* ================= FIND ORDER ================= */
//   const order = await Order.findOne({ orderId });
//   if (!order) {
//     throw new Error("Order not found");
//   }
//   /* ================= FIND RETURN REQUEST ================= */
//   const returnRequest = order.returnRequests.find(
//     (r) => r.requestId?.toString() === requestId?.toString()
//   );
//   if (!returnRequest) {
//     throw new Error("Return request not found");
//   }
//   if (returnRequest.status !== "pending") {
//     throw new Error("Only pending requests can be updated");
//   }
//   if (!Array.isArray(returnItems)) {
//     throw new Error("returnItems must be an array");
//   }
//   /* ================= VALIDATE ITEMS ================= */
//   const validatedItems = [];
//   for (const item of returnItems) {
//     const { productId, variantId, quantity, reason } = item;
//     if (!productId || !variantId || !quantity || Number(quantity) <= 0) {
//       throw new Error("Invalid return item data");
//     }
//     const orderItem = order.items.find(
//       (o) =>
//         o.productId?.toString() === productId?.toString() &&
//         o.variantId?.toString() === variantId?.toString()
//     );
//     if (!orderItem) {
//       throw new Error("Product not found in order");
//     }
//     /* ---------- QUANTITY CHECK ---------- */
//     const alreadyReturnedQty = Number(orderItem.returnedQuantity || 0);
//     const maxAllowedQty = Number(orderItem.quantity);
//     if (Number(quantity) > maxAllowedQty) {
//       throw new Error(
//         `Return quantity exceeds ordered quantity for ${orderItem.productName}`
//       );
//     }
//     if (orderItem.price == null || Number(orderItem.price) <= 0) {
//       throw new Error(`Invalid price found in order for ${orderItem.productName}`);
//     }
//     validatedItems.push({
//       productId,
//       variantId,
//       quantity: Number(quantity),
//       price: Number(orderItem.price),
//       reason: reason || null,
//     });
//   }
//   /* ================= UPDATE / DELETE ================= */
//   if (validatedItems.length === 0) {
//     order.returnRequests = order.returnRequests.filter(
//       (r) => r.requestId?.toString() !== requestId?.toString()
//     );
//   } else {
//     returnRequest.items = validatedItems;
//     returnRequest.updatedAt = new Date();
//   }
//   await order.save();
//   /* ================= SEND NOTIFICATION ================= */
// await sendNotification({
//   permission: "update_stock",
//   title: "Return Request Updated",
//   message: `Return request updated for order ${order.orderId}`,
//   type: "RETURN_REQUEST_UPDATED",
//   entityId: order._id,
//   entityModel: "Order",
//   metadata: {
//     orderId: order.orderId,
//     requestId,
//     customerName: order.user?.name || "Customer",
//     totalItems: validatedItems.length,
//     items: validatedItems.map((item) => ({
//       productId: item.productId,
//       variantId: item.variantId,
//       quantity: item.quantity,
//       reason: item.reason,
//     })),
//   },
// });
//      /* ---------- NOTIFICATION ---------- */
//         try {
//           await sendNotification({
//             sender: employee?._id,
//             permission: "sales.order.update",
//             title: "Order Refund Updated",
//             message: `Order refund updated for ${order.orderId}`,
//             type: "ORDER_REFUND_UPDATED",
//             entityId: order._id,
//             entityModel: "Order",
//             metadata: {
//               orderId: order.orderId,
//               createdBy: employee?.email || null,
//             },
//           });
//         } catch (err) {
//           console.error("Notification failed on order refund update:", err.message);
//         }
//   return {
//     orderId,
//     requestId,
//     items: validatedItems,
//   };
// };

// export const getAllReturnRequestsService = async () => {
//   /* ================= FETCH ORDERS WITH RETURNS ================= */

//   const orders = await Order.find({
//     returnRequests: { $exists: true, $ne: [] },
//   })
//     .populate("user", "firstName lastName email instituteName")
//     .sort({ createdAt: -1 })
//     .lean();

//   return {
//     totalOrders: orders.length,
//     orders,
//   };
// };

// export const updateReturnRequestStatusService = async (data) => {
//   const { orderId, requestId, status, items, permission, userEmail } = data;

//   const session = await mongoose.startSession();

//   try {
//     session.startTransaction();

//     /* ---------- FETCH EMPLOYEE ---------- */
//     const employee = await Employee.findOne({ email: userEmail }).session(session);

//     if (!employee) {
//       throw new Error("Employee not found");
//     }

//     /* ---------- FETCH ORDER ---------- */
//     const order = await Order.findOne({ orderId })
//       .populate("user")
//       .session(session);

//     if (!order) {
//       throw new Error("Order not found");
//     }

//     /* ---------- FIND RETURN REQUEST ---------- */
//     const returnRequest = order.returnRequests.find(
//       (r) => r.requestId === requestId
//     );

//     if (!returnRequest) {
//       throw new Error("Return request not found");
//     }

//     if (returnRequest.status !== "pending") {
//       throw new Error("Request already processed");
//     }

//     const stockProducts = [];

//     /* ================= APPROVED ================= */
//     if (status === "approved") {

//       if (!Array.isArray(items) || items.length === 0) {
//         throw new Error("Approved items required");
//       }

//       for (const approvedItem of items) {

//         const { productId, variantId, approvedQuantity } = approvedItem;

//         if (!approvedQuantity || approvedQuantity <= 0) {
//           throw new Error("Invalid approved quantity");
//         }

//         /* ---------- REQUEST ITEM ---------- */
//         const requestedItem = returnRequest.items.find(
//           (i) =>
//             i.productId == productId &&
//             i.variantId == variantId
//         );

//         if (!requestedItem) {
//           throw new Error("Item not found in return request");
//         }
//         if (approvedQuantity > requestedItem.quantity) {
//           throw new Error("Approved quantity exceeds requested quantity");
//         }

//         /* ---------- ORDER ITEM ---------- */
//         const orderItem = order.items.find(
//           (o) =>
//             o.productId == productId &&
//             o.variantId == variantId
//         );

//         if (!orderItem) continue;

//         const alreadyReturned = orderItem.returnedQuantity || 0;
//         const totalOrderedQuantity = orderItem.quantity + alreadyReturned;
//        if (alreadyReturned + approvedQuantity > totalOrderedQuantity) {
//        throw new Error("Return quantity exceeds allowed limit");
//       }
//         /* ---------- PRODUCT STOCK ---------- */
//         const product = await Product.findOne({ productId }).session(session);
//         if (product) {
//           if (product.stockType === "PRODUCT") {
//             product.productStock += approvedQuantity;
//           }
//           if (product.stockType === "VARIANT") {
//             const variant = product.variants.find(
//               (v) => v.variantId === variantId
//             );
//             if (variant) {
//               variant.variantStock += approvedQuantity;
//             }
//           }
//           await product.save({ session });
//         }
//         /* ---------- ORDER UPDATE ---------- */
//         orderItem.returnedQuantity =
//           (orderItem.returnedQuantity || 0) + approvedQuantity;
//         orderItem.quantity -= approvedQuantity;
//         if (orderItem.quantity < 0) orderItem.quantity = 0;
//         stockProducts.push({ productId, variantId, quantity: approvedQuantity });
//       }
//       /* ---------- ORDER STATUS ---------- */
//       const remainingQuantity = order.items.reduce(
//         (sum, item) => sum + item.quantity,
//         0
//       );

//       const returnedQuantity = order.items.reduce(
//         (sum, item) => sum + (item.returnedQuantity || 0),
//         0
//       );

//       if (remainingQuantity === 0 && returnedQuantity > 0) {
//         order.orderStatus = "returned";
//       } else if (returnedQuantity > 0) {
//         order.orderStatus = "partial_returned";
//       }
//       if (["returned", "partial_returned"].includes(order.orderStatus)) {
//         order.paymentStatus = "refund_pending";
//       }
//            /* ---------- NOTIFICATION ---------- */
//         try {
//           await sendNotification({
//             sender: employee?._id,
//             permission: "sales.order.update",
//             title: "Update Order Refund Status",
//             message: `Order refund updated for ${order.orderId}`,
//             type: "ORDER_REFUND_UPDATED",
//             entityId: order._id,
//             entityModel: "Order",
//             metadata: {
//               orderId: order.orderId,
//               createdBy: employee?.email || null,
//             },
//           });
//         } catch (err) {
//           console.error("Notification failed on order refund update:", err.message);
//         }

//       /* ---------- STOCK AUDIT ---------- */
//       if (stockProducts.length > 0) {
//         await StockAuditLog.create(
//           [{
//             orderId: order.orderId,
//             action: "add",
//             products: stockProducts,
//             time: new Date(),
//           }],
//           { session }
//         );
//       }
//     }

//     /* ================= REJECTED ================= */
//     // no stock updates

//     /* ---------- UPDATE REQUEST ---------- */
//     returnRequest.status = status;
//     returnRequest.processedAt = new Date();
//     returnRequest.processedBy = employee._id;

//     await order.save({ session });

//     /* ---------- PERMISSION AUDIT ---------- */
//     await PermissionAudit.create(
//       [{
//         permissionAuditId: uuidv6(),
//         actionBy: employee._id,
//         actionByEmail: employee.email,
//         actionFor: order._id,
//         action: `Return request ${requestId} ${status} for order ${order.orderId}`,
//         permission: permission || "update_return_request_status",
//         actionType: "Update return request status",
//       }],
//       { session }
//     );
//     await session.commitTransaction();
//     session.endSession();
//     return {
//       orderId: order.orderId,
//       requestId,
//       status,
//       processedAt: returnRequest.processedAt,
//     };
//   } catch (error) {
//     await session.abortTransaction();
//     session.endSession();
//     throw error;
//   }
// };

// export const updateCourierDetailsService = async (data) => {
//   const { orderId, corourseServiceName, DOCNumber, permission, userEmail } = data;

//   /* ---------- FETCH EMPLOYEE ---------- */
//   const employee = await Employee.findOne({ email: userEmail });

//   if (!employee) {
//     throw new Error("Employee not found");
//   }

//   /* ---------- FETCH ORDER ---------- */
//   const order = await Order.findOne({ orderId }).populate("user");

//   if (!order) {
//     throw new Error("Order not found");
//   }

//   /* ---------- UPDATE FIELDS ---------- */
//   if (corourseServiceName) {
//     order.corourseServiceName = corourseServiceName;
//   }

//   if (DOCNumber) {
//     order.DOCNumber = DOCNumber;
//   }

//   order.statusUpdatedAt = new Date();

//   await order.save();

//   /* ---------- AUDIT LOG ---------- */
//   await PermissionAudit.create({
//     permissionAuditId: uuidv6(),
//     actionBy: employee._id,
//     actionByEmail: employee.email,
//     actionFor: order._id,
//     action: `Courier details updated for order ${order.orderId} 
// (Service: ${order.corourseServiceName}, DOC: ${order.DOCNumber})`,
//     permission: permission || "update_courier_details",
//     actionType: "Update courier details",
//   });
//   return {
//     orderId: order.orderId,
//     corourseServiceName: order.corourseServiceName,
//     DOCNumber: order.DOCNumber,
//     updatedAt: order.statusUpdatedAt,
//   };
// };


import User from "../models/ecommarace/user.model.js";
import Cart from "../models/ecommarace/cart.model.js";
import Product from "../models/manage/product.model.js";
import Coupon from "../models/manage/coupon.model.js";
import { v6 as uuidv6 } from "uuid";
import { getStock, resolvePrice, resolveImages } from "../services/productResolver.service.js";
import crypto from "crypto";
import Order from "../models/ecommarace/order.model.js";
import Payment from "../models/ecommarace/paymentaudit.model.js";
import StockAuditLog from "../models/ecommarace/stockauditlog.model.js";
import { sendZohoMail } from "./ZohoEmail/zohoMail.service.js";
import { orderConfirmationTemplate } from "../config/templates/orderConfirmationTemplate.js";
import { adminOrderCancelledTemplate } from "../config/templates/adminOrderCancelledTemplate.js";
import Employee from "../models/manage/employee.model.js";
import Razorpay from "razorpay";
import { getPagination } from "../helpers/pagination.helper.js";
import mongoose from "mongoose";
import { PermissionAudit } from "../models/manage/permissionaudit.model.js";
import { sendNotification } from "./notification.service.js";
import { orderStatusUpdateTemplate } from "../config/templates/orderStatusUpdateTemplate.js";

const razorpayInstance = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

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
        console.error(`Low stock email failed for ${emp.email}:`, err.message);
      }
    }
  } catch (err) {
    console.error("Low stock alert failed:", err.message);
  }
};

export const createOrderService = async (data, currentUser) => {
  if (!currentUser?._id) {
    const error = new Error("Unauthorized user");
    error.statusCode = 401;
    error.errorCode = "UNAUTHORIZED";
    throw error;
  }

  const user = await User.findById(currentUser._id).lean();
  if (!user) {
    const error = new Error("User not found");
    error.statusCode = 404;
    error.errorCode = "USER_NOT_FOUND";
    throw error;
  }

  if (!user.cart) {
    const error = new Error("Cart is empty");
    error.statusCode = 400;
    error.errorCode = "CART_EMPTY";
    throw error;
  }

  const cart = await Cart.findById(user.cart).lean();
  if (!cart || !Array.isArray(cart.items) || cart.items.length === 0) {
    const error = new Error("Cart is empty");
    error.statusCode = 400;
    error.errorCode = "CART_EMPTY";
    throw error;
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
    const error = new Error("Cart is empty or items are required");
    error.statusCode = 400;
    error.errorCode = "INVALID_ITEMS";
    throw error;
  }

  if (!addressId) {
    const error = new Error("addressId is required");
    error.statusCode = 400;
    error.errorCode = "ADDRESS_ID_REQUIRED";
    throw error;
  }

  if (!billingAddress || typeof billingAddress !== "object") {
    const error = new Error("billingAddress is required");
    error.statusCode = 400;
    error.errorCode = "BILLING_ADDRESS_REQUIRED";
    throw error;
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
      const error = new Error(`billingAddress.${field} is required`);
      error.statusCode = 400;
      error.errorCode = "INVALID_BILLING_ADDRESS";
      throw error;
    }
  }

  /* ================= ADDRESS ================= */
  const possibleAddressSources = [
    user.addresses,
    user.shippingAddress,
    user.shippingAddresses,
    user.address,
  ];

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
    const error = new Error("No addresses found for user");
    error.statusCode = 400;
    error.errorCode = "ADDRESS_NOT_FOUND";
    throw error;
  }

  const selectedAddress =
    addressList.find(
      (addr) => addr?.addressId?.toString() === addressId?.toString()
    ) ||
    addressList.find(
      (addr) => addr?._id?.toString() === addressId?.toString()
    ) ||
    addressList.find((addr) => addr?.id?.toString() === addressId?.toString());

  if (!selectedAddress) {
    const error = new Error("Address not found");
    error.statusCode = 404;
    error.errorCode = "ADDRESS_NOT_FOUND";
    throw error;
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
    const error = new Error("Selected address is incomplete");
    error.statusCode = 400;
    error.errorCode = "INVALID_ADDRESS";
    throw error;
  }

  /* ================= ITEMS ================= */
  let subtotal = 0;
  const items = [];
  const cartLines = []; // used only for server-side coupon discount calculation

  for (const item of frontendItems) {
    const { productId, variantId, quantity } = item;
    if (!productId || !variantId || !quantity || Number(quantity) <= 0) {
      const error = new Error("Invalid item data");
      error.statusCode = 400;
      error.errorCode = "INVALID_ITEM_DATA";
      throw error;
    }
    const product = await Product.findOne({
      productId,
      status: "active",
    })
      .populate("category", "name")
      .lean();

    if (!product) {
      const error = new Error(`Product unavailable: ${productId}`);
      error.statusCode = 404;
      error.errorCode = "PRODUCT_NOT_FOUND";
      throw error;
    }

    if (!Array.isArray(product.variants) || product.variants.length === 0) {
      const error = new Error(`No variants available for product: ${productId}`);
      error.statusCode = 404;
      error.errorCode = "VARIANTS_NOT_FOUND";
      throw error;
    }

    const variant = product.variants.find(
      (v) => v?.variantId?.toString() === variantId?.toString()
    );

    if (!variant) {
      const error = new Error(`Variant unavailable: ${variantId}`);
      error.statusCode = 404;
      error.errorCode = "VARIANT_NOT_FOUND";
      throw error;
    }

    const availableStock = getStock(product, variantId);
    if (availableStock < Number(quantity)) {
      const error = new Error(
        `Only ${availableStock} item(s) available for ${product.name}`
      );
      error.statusCode = 400;
      error.errorCode = "INSUFFICIENT_STOCK";
      throw error;
    }

    const itemPrice = resolvePrice(product, variant);
    if (Number.isNaN(Number(itemPrice)) || Number(itemPrice) <= 0) {
      const error = new Error(`Invalid product price for ${product.name}`);
      error.statusCode = 400;
      error.errorCode = "INVALID_PRICE";
      throw error;
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
      const error = new Error("Invalid coupon");
      error.statusCode = 400;
      error.errorCode = "INVALID_COUPON";
      throw error;
    }

    if (coupon.isActive === false) {
      const error = new Error("This coupon is no longer active");
      error.statusCode = 400;
      error.errorCode = "COUPON_INACTIVE";
      throw error;
    }

    if (coupon.minOrderAmount && subtotal < coupon.minOrderAmount) {
      const error = new Error(
        `Minimum order amount of ₹${coupon.minOrderAmount} required for this coupon`
      );
      error.statusCode = 400;
      error.errorCode = "COUPON_MIN_AMOUNT_NOT_MET";
      throw error;
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
    const error = new Error("Invalid order amount");
    error.statusCode = 400;
    error.errorCode = "INVALID_ORDER_AMOUNT";
    throw error;
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
    console.error("Notification failed on create order:", err.message);
  }

  return {
    razorpayOrderId: razorpayOrder.id,
    amount: razorpayOrder.amount,
    currency: razorpayOrder.currency,
    orderItem,
  };
};

export const verifyRazorpayService = async (data, currentUser) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderItem } = data;

  /* ================= VALIDATION ================= */
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    throw new Error("Missing payment details");
  }

  if (!orderItem?.orderId) {
    throw new Error("Invalid order data");
  }

  if (!currentUser?._id) {
    throw new Error("Unauthorized user");
  }

  /* ================= VERIFY SIGNATURE ================= */
  const body = `${razorpay_order_id}|${razorpay_payment_id}`;
  const expectedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest("hex");

  if (expectedSignature !== razorpay_signature) {
    throw new Error("Invalid Razorpay signature");
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
      throw new Error("User not found");
    }

    /* ================= FIND EXISTING ORDER ================= */
    order = await Order.findOne({
      orderId: orderItem.orderId,
      user: currentUser._id,
      razorpayOrderId: razorpay_order_id,
    }).session(session);

    if (!order) {
      throw new Error("Order not found");
    }

    /* ================= PREVENT DOUBLE PAYMENT PROCESS ================= */
    if (order.paymentStatus === "paid") {
      throw new Error("Order is already paid");
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
        throw new Error(`Product not found: ${item.productId}`);
      }

      const variant = product.variants.find((v) => v.variantId === item.variantId);
      if (!variant) {
        throw new Error(`Variant not found: ${item.variantId}`);
      }

      if (product.stockType === "PRODUCT") {
        if (product.productStock < item.quantity) {
          const err = new Error(
            `Insufficient stock for ${product.name}. Your payment was captured — please contact support for a refund.`
          );
          err.statusCode = 409;
          err.errorCode = "OUT_OF_STOCK_POST_PAYMENT";
          throw err;
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
          const err = new Error(
            `Insufficient stock for ${product.name} (${variant.name}). Your payment was captured — please contact support for a refund.`
          );
          err.statusCode = 409;
          err.errorCode = "OUT_OF_STOCK_POST_PAYMENT";
          throw err;
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
      await StockAuditLog.create(
        [{ orderId: order.orderId, action: "deduct", products: deductedProducts }],
        { session }
      );
    }

    /* ================= CLEAR CART ================= */
    await Cart.findByIdAndUpdate(
      user.cart,
      { $set: { items: [] } },
      { session }
    );

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
    console.error("Notification failed on verify payment:", err.message);
  }

  /* ================= EMAIL ================= */
  try {
    const emailHtml = orderConfirmationTemplate(
      user.firstName,
      order.orderId,
      order.grandTotal,
      order.items
    );

    await sendZohoMail(user.email, "Payment Successful - Order Confirmed", emailHtml);

    await sendLowStockAlertToAdmins(lowStockProducts);
  } catch (err) {
    console.log("EMAIL ERROR:", err.message);
  }

  return order;
};

export const getUserOrdersService = async (query, currentUser) => {
  if (!currentUser?._id) {
    throw new Error("Unauthorized user");
  }

  const { month, year } = query;
  const filter = { user: currentUser._id };
  if (month && year) {
    const m = Number(month);
    const y = Number(year);
    if (isNaN(m) || isNaN(y) || m < 1 || m > 12 || y < 2000) {
      throw new Error("Invalid month or year");
    }
    filter.createdAt = {
      $gte: new Date(y, m - 1, 1),
      $lt: new Date(y, m, 1),
    };
  }

  const [orders, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).lean(),
    Order.countDocuments(filter),
  ]);

  return {
    filters: {
      month: month || null,
      year: year || null,
    },
    orders,
  };
};

export const getSingleOrderService = async (orderId, currentUser) => {
  if (!currentUser?._id) {
    throw new Error("Unauthorized user");
  }

  if (!orderId) {
    throw new Error("orderId is required");
  }

  const order = await Order.findOne({
    orderId,
    user: currentUser._id,
  }).lean();

  if (!order) {
    throw new Error("Order not found");
  }

  return order;
};

export const cancelOrderService = async (orderId, currentUser, reason) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (!currentUser?._id) {
      throw new Error("Unauthorized user");
    }

    if (!orderId) {
      throw new Error("orderId is required");
    }

    const order = await Order.findOne({ orderId, user: currentUser._id }).session(session);

    if (!order) {
      throw new Error("Order not found");
    }

    const nonCancellableStates = ["delivered", "cancelled", "shipped"];
    if (nonCancellableStates.includes(order.orderStatus)) {
      throw new Error(`Order cannot be cancelled once ${order.orderStatus}`);
    }

    // ----------------------------
    // RESTORE STOCK IF PAID
    // ----------------------------
    let restoredProducts = [];

    if (order.paymentStatus === "paid") {
      for (const item of order.items) {
        const product = await Product.findOne({ productId: item.productId, status: "active" }).session(session);

        if (!product) throw new Error(`Product not found: ${item.productName}`);

        if (product.stockType === "PRODUCT") {
          product.productStock += item.quantity;
        } else if (product.stockType === "VARIANT") {
          const variant = product.variants.find((v) => v.variantId === item.variantId);
          if (!variant) throw new Error(`Variant not found: ${item.variantName}`);
          variant.variantStock += item.quantity;
        }

        restoredProducts.push({ productId: item.productId, variantId: item.variantId, quantity: item.quantity });
        await product.save({ session });
      }

      if (restoredProducts.length > 0) {
        await StockAuditLog.create(
          [{ orderId: order.orderId, action: "add", products: restoredProducts }],
          { session }
        );
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
      const customerName = currentUser.firstName || currentUser.lastName
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
      console.error("Admin email failed:", err.message);
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
      console.error("Notification failed on cancel order:", err.message);
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

export const markRefundCompletedService = async (orderId, currentUser) => {
  if (!currentUser?._id) {
    throw Object.assign(new Error("Unauthorized user"), { statusCode: 401 });
  }

  const order = await Order.findOne({ orderId });
  if (!order) throw Object.assign(new Error("Order not found"), { statusCode: 404 });

  // Allow either the order's owner (typical post-cancel flow triggered by the
  // customer) or an authorized employee to complete the refund.
  const isOwner = order.user?.toString() === currentUser._id.toString();
  const employee = await Employee.findOne({ email: currentUser.email });
  if (!isOwner && !employee) {
    throw Object.assign(new Error("Not authorized to process this refund"), { statusCode: 403 });
  }

  if (order.orderStatus !== "cancelled") throw Object.assign(new Error("Order is not cancelled"), { statusCode: 400 });
  if (order.paymentStatus === "refunded") throw Object.assign(new Error("Refund already completed"), { statusCode: 400 });
  if (order.paymentStatus !== "refund_pending") throw Object.assign(new Error("Refund not in pending state"), { statusCode: 400 });
  if (!order.razorpayPaymentId) throw Object.assign(new Error("Razorpay paymentId not found"), { statusCode: 400 });
  if (!order.refundAmount || order.refundAmount <= 0) throw Object.assign(new Error("Invalid refund amount"), { statusCode: 400 });

  // Process Razorpay refund
  const refund = await razorpayInstance.payments.refund(order.razorpayPaymentId, {
    amount: Math.round(order.refundAmount * 100),
    speed: "normal",
    notes: {
      orderId: order.orderId,
      reason: order.cancellationReason || "Order cancelled refund",
    },
  });

  // Update order after refund
  order.paymentStatus = "refunded";
  order.refundedAt = new Date();
  order.razorpayRefundId = refund.id;
  order.refundHistory = order.refundHistory || [];
  order.refundHistory.push({
    refundId: refund.id,
    amount: order.refundAmount,
    refundStatus: refund.status || "processed",
    refundedAt: new Date(),
  });

  await order.save();

  /* ---------- NOTIFICATION ---------- */
  try {
    await sendNotification({
      sender: currentUser._id,
      permission: "sales.order.update",
      title: "Order Refunded",
      message: `Refund completed for order ${order.orderId}`,
      type: "ORDER_REFUNDED",
      entityId: order._id,
      entityModel: "Order",
      metadata: {
        orderId: order.orderId,
        processedBy: employee?.email || currentUser.email || null,
      },
    });
  } catch (err) {
    console.error("Notification failed on refund complete:", err.message);
  }

  return {
    orderId: order.orderId,
    orderStatus: order.orderStatus,
    paymentStatus: order.paymentStatus,
    refundAmount: order.refundAmount,
    refundedAt: order.refundedAt,
    razorpayRefundId: refund.id,
    razorpayRefundStatus: refund.status,
  };
};

export const updateOrderStatusService = async (data, currentUser) => {
  const { orderId, status, permission } = data;

  /* ---------- AUTH ---------- */
  const employee = await Employee.findOne({ email: currentUser.email });
  if (!employee) {
    const err = new Error("Employee not found");
    err.statusCode = 404;
    throw err;
  }

  /* ---------- FETCH ORDER ---------- */
  const order = await Order.findOne({ orderId }).populate("user");
  if (!order) {
    const err = new Error("Order not found");
    err.statusCode = 404;
    throw err;
  }

  const currentStatus = order.orderStatus;

  /* ---------- FINAL STATE CHECK ---------- */
  if (["cancelled", "returned"].includes(currentStatus)) {
    const err = new Error(
      `Order cannot be updated because it is already ${currentStatus}`
    );
    err.statusCode = 400;
    throw err;
  }

  /* ---------- STATUS FLOW ---------- */
  const statusFlow = {
    placed: ["packed", "confirmed", "shipped"],
    packed: ["confirmed", "shipped"],
    confirmed: ["shipped"],
    shipped: ["delivered"],
  };

  if (currentStatus === status) {
    const err = new Error(`Order already in status ${status}`);
    err.statusCode = 400;
    throw err;
  }

  const allowedNextStatuses = statusFlow[currentStatus] || [];

  if (!allowedNextStatuses.includes(status)) {
    const err = new Error(
      `Invalid status update: cannot change from "${currentStatus}" to "${status}"`
    );
    err.statusCode = 400;
    throw err;
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
    const err = new Error(
      "Order was modified by another process. Please retry."
    );
    err.statusCode = 409;
    throw err;
  }

  /* ---------- EMAIL (NON-BLOCKING) ---------- */
  try {
    const emailHtml = orderStatusUpdateTemplate(
      updatedOrder.user?.name || "Customer",
      updatedOrder.orderId,
      status
    );

    await sendZohoMail(
      updatedOrder.user?.email,
      `Order Update: ${updatedOrder.orderId}`,
      emailHtml
    );
  } catch (emailError) {
    console.log("Failed to send order status update email:", emailError.message);
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
    console.error("Notification failed on order status update:", err.message);
  }

  return {
    orderId: updatedOrder.orderId,
    oldStatus: currentStatus,
    newStatus: status,
    paymentStatus: updatedOrder.paymentStatus,
    statusUpdatedAt: updatedOrder.statusUpdatedAt,
  };
};

export const getOrdersByStatusService = async (data) => {
  const { status, page, limit } = data;

  const skip = (page - 1) * limit;

  const [orders, total] = await Promise.all([
    Order.find({ orderStatus: status })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),

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

export const markRefundCompleteAdminService = async ({ orderId, amount }, currentUser) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    /* ---------- EMPLOYEE ---------- */
    const employee = await Employee.findOne({ email: currentUser.email }).session(session);

    if (!employee) {
      const err = new Error("Employee not found");
      err.statusCode = 404;
      throw err;
    }

    /* ---------- ORDER ---------- */
    const order = await Order.findOne({ orderId }).session(session);

    if (!order) {
      const err = new Error("Order not found");
      err.statusCode = 404;
      throw err;
    }

    /* ---------- STATUS VALIDATION ---------- */
    if (!["returned", "partial_returned"].includes(order.orderStatus)) {
      const err = new Error(
        `Order is not eligible for refund. Current status: ${order.orderStatus}`
      );
      err.statusCode = 400;
      throw err;
    }

    if (!["refund_pending", "partial_refunded"].includes(order.paymentStatus)) {
      const err = new Error(
        `Refund not allowed. Current paymentStatus: ${order.paymentStatus}`
      );
      err.statusCode = 400;
      throw err;
    }

    if (!order.razorpayPaymentId) {
      const err = new Error("Razorpay paymentId not found");
      err.statusCode = 400;
      throw err;
    }

    /* ---------- RAZORPAY FETCH ---------- */
    let paymentDetails;
    try {
      paymentDetails = await razorpayInstance.payments.fetch(order.razorpayPaymentId);
    } catch (rzpErr) {
      const err = new Error(
        rzpErr?.error?.description ||
          `Could not fetch payment ${order.razorpayPaymentId} from Razorpay`
      );
      err.statusCode = 400;
      throw err;
    }

    /* ---------- PAYMENT STATE GUARD ----------
       Razorpay can only refund a payment that is in the "captured" state.
       An "authorized" (not captured) payment, or one already "refunded",
       makes payments.refund() throw an opaque error — catch it early with
       a message the operator can act on. */
    if (paymentDetails.status === "refunded") {
      const err = new Error("This payment is already fully refunded on Razorpay");
      err.statusCode = 400;
      throw err;
    }
    if (paymentDetails.status !== "captured") {
      const err = new Error(
        `Payment is "${paymentDetails.status}", not "captured" — Razorpay cannot refund it yet`
      );
      err.statusCode = 400;
      throw err;
    }

    const totalPaidAmount = paymentDetails.amount / 100;

    // Trust Razorpay's own refunded figure, not just our local counter — a
    // refund done straight from the Razorpay dashboard would otherwise be missed.
    const rzpAlreadyRefunded = (paymentDetails.amount_refunded || 0) / 100;
    const alreadyRefundedAmount = Math.max(order.partialRefundAmount || 0, rzpAlreadyRefunded);
    const remainingRefundableAmount = totalPaidAmount - alreadyRefundedAmount;

    if (remainingRefundableAmount <= 0) {
      const err = new Error("No refundable amount left");
      err.statusCode = 400;
      throw err;
    }

    /* ---------- REFUND AMOUNT ---------- */
    let refundAmount = remainingRefundableAmount;

    if (amount !== undefined && amount !== null) {
      if (typeof amount !== "number" || amount <= 0) {
        const err = new Error("Invalid refund amount");
        err.statusCode = 400;
        throw err;
      }

      if (amount > remainingRefundableAmount) {
        const err = new Error(
          `Refund amount exceeds remaining refundable amount ₹${remainingRefundableAmount}`
        );
        err.statusCode = 400;
        throw err;
      }

      refundAmount = amount;
    }

    /* ---------- PROCESS REFUND ---------- */
    let refund;
    try {
      refund = await razorpayInstance.payments.refund(order.razorpayPaymentId, {
        amount: Math.round(refundAmount * 100),
        notes: {
          orderId: order.orderId,
          refundedBy: employee.email,
        },
      });
    } catch (rzpErr) {
      const err = new Error(
        rzpErr?.error?.description || rzpErr?.message || "Razorpay refund failed"
      );
      err.statusCode = 400;
      throw err;
    }

    /* ---------- UPDATE ORDER ---------- */
    const newTotalRefunded = alreadyRefundedAmount + refundAmount;
    const newRemainingAmount = totalPaidAmount - newTotalRefunded;

    order.partialRefundAmount = newTotalRefunded;
    order.remainingRefundAmount = newRemainingAmount;
    order.paymentStatus = newTotalRefunded >= totalPaidAmount ? "refunded" : "partial_refunded";

    order.refundedAt = new Date();
    order.razorpayRefundId = refund.id;

    order.refundHistory = order.refundHistory || [];
    order.refundHistory.push({
      refundId: refund.id,
      amount: refundAmount,
      refundedBy: employee.email,
      refundedAt: new Date(),
      refundStatus: refund.status,
    });

    await order.save({ session });

    /* ---------- AUDIT LOG ---------- */
    await PermissionAudit.create(
      [
        {
          permissionAuditId: uuidv6(),
          actionBy: employee._id,
          actionByEmail: employee.email,
          actionFor: order._id,
          actionForEmail: null,
          permission: "initiate_refund",
          action: "refund",
          meta: {
            orderId: order.orderId,
            amount: refundAmount,
          },
        },
      ],
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    /* ---------- NOTIFICATION (after commit) ---------- */
    try {
      await sendNotification({
        sender: employee._id,
        permission: "sales.order.update",
        title: "Order Refund Updated",
        message: `Order refund processed for ${order.orderId}`,
        type: "ORDER_REFUND_UPDATED",
        entityId: order._id,
        entityModel: "Order",
        metadata: {
          orderId: order.orderId,
          amount: refundAmount,
          processedBy: employee.email || null,
        },
      });
    } catch (err) {
      console.error("Notification failed on admin refund complete:", err.message);
    }

    return {
      orderId: order.orderId,
      orderStatus: order.orderStatus,
      paymentStatus: order.paymentStatus,
      totalPaidAmount,
      totalRefundedAmount: newTotalRefunded,
      remainingRefundableAmount: newRemainingAmount,
      refundedNow: refundAmount,
      refundedAt: order.refundedAt,
      razorpayRefundId: refund.id,
      refundHistory: order.refundHistory,
    };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

export const salesDashboardService = async (data) => {
  const { startDate, endDate, country, state, top } = data;

  const safeTop = Math.min(parseInt(top) || 10, 50);

  const baseMatch = {
    orderStatus: { $nin: ["cancelled", "returned"] },
  };

  if (startDate || endDate) {
    baseMatch.createdAt = {};

    if (startDate) {
      baseMatch.createdAt.$gte = new Date(`${startDate}T00:00:00.000Z`);
    }

    if (endDate) {
      baseMatch.createdAt.$lte = new Date(`${endDate}T23:59:59.999Z`);
    }
  }

  if (country) {
    baseMatch["shippingAddress.country"] = country;
  }

  if (state) {
    baseMatch["shippingAddress.state"] = state;
  }

  let groupField;
  let level;

  if (!country && !state) {
    groupField = "$shippingAddress.country";
    level = "country";
  } else if (country && !state) {
    groupField = "$shippingAddress.state";
    level = "state";
  } else {
    groupField = "$shippingAddress.city";
    level = "city";
  }

  const result = await Order.aggregate([
    { $match: baseMatch },
    {
      $addFields: {
        netRevenue: {
          $subtract: ["$grandTotal", { $ifNull: ["$partialRefundAmount", 0] }],
        },
      },
    },
    {
      $group: {
        _id: groupField,
        totalRevenue: { $sum: "$netRevenue" },
        totalOrders: { $sum: 1 },
      },
    },
    { $sort: { totalRevenue: -1 } },
    { $limit: safeTop },
  ]);

  const analytics = result.map((item) => ({
    name: item._id || "Unknown",
    totalRevenue: item.totalRevenue,
    totalOrders: item.totalOrders,
    averageOrderValue: item.totalOrders
      ? +(item.totalRevenue / item.totalOrders).toFixed(2)
      : 0,
  }));

  return {
    level,
    filters: {
      startDate,
      endDate,
      country,
      state,
    },
    analytics,
  };
};

export const createReturnRequestService = async (data, currentUser) => {
  const { orderId, returnItems } = data;

  if (!currentUser?._id) {
    throw Object.assign(new Error("Unauthorized user"), { statusCode: 401 });
  }

  /* ================= FIND ORDER (ownership enforced) ================= */
  const order = await Order.findOne({ orderId, user: currentUser._id }).populate("user");
  if (!order) {
    throw Object.assign(new Error("Order not found"), { statusCode: 404 });
  }

  const allowedStatuses = ["delivered", "partial_returned"];
  if (!allowedStatuses.includes(order.orderStatus)) {
    throw new Error("Only delivered or partially returned orders can be returned");
  }
  if (!Array.isArray(returnItems) || returnItems.length === 0) {
    throw new Error("Return items are required");
  }

  /* ================= VALIDATE RETURN ITEMS ================= */
  const validatedItems = [];
  for (const item of returnItems) {
    const { productId, variantId, quantity, reason } = item;
    if (!productId || !variantId || !quantity || Number(quantity) <= 0) {
      throw new Error("Invalid return item data");
    }
    const orderItem = order.items.find(
      (o) =>
        o.productId?.toString() === productId?.toString() &&
        o.variantId?.toString() === variantId?.toString()
    );
    if (!orderItem) {
      throw new Error("Product not found in order");
    }
    const availableQuantity = Number(orderItem.quantity) - Number(orderItem.returnedQuantity || 0);

    if (Number(quantity) > availableQuantity) {
      throw new Error(
        `Return quantity exceeds available quantity for ${orderItem.productName}`
      );
    }

    if (orderItem.price == null || Number(orderItem.price) <= 0) {
      throw new Error(`Invalid price found in order for ${orderItem.productName}`);
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
    console.error("Notification failed on return request create:", err.message);
  }

  /* ================= EMAIL (background, non-blocking) ================= */
  sendReturnRequestEmails(order, validatedItems, newRequestId).catch((err) => {
    console.error("Email background job failed:", err.message);
  });

  return {
    orderId: order.orderId,
    requestId: newRequestId,
  };
};

const sendReturnRequestEmails = async (order, validatedItems, requestId) => {
  try {
    const employees = await Employee.find({
      permissions: { $in: ["update_stock"] },
      isActive: true,
    });

    if (!employees || employees.length === 0) {
      console.log("No stock employees found");
      return;
    }

    const itemsHtml = validatedItems
      .map((i) => `<li>Product ${i.productId} / Variant ${i.variantId} — Qty ${i.quantity}${i.reason ? ` (${i.reason})` : ""}</li>`)
      .join("");

    const emailHtml = `
      <p>A new return request has been submitted for order <b>${order.orderId}</b>
      by ${order.user?.name || "Customer"}.</p>
      <ul>${itemsHtml}</ul>
    `;

    for (const emp of employees) {
      try {
        await sendZohoMail(
          emp.email,
          `New Return Request - ${order.orderId}`,
          emailHtml
        );
      } catch (err) {
        console.error(`Failed email to ${emp.email}:`, err.message);
      }
    }
  } catch (err) {
    console.error("Error fetching employees:", err.message);
  }
};

export const updatePendingReturnRequestService = async (data, currentUser) => {
  const { orderId, requestId, returnItems } = data;

  if (!currentUser?._id) {
    throw Object.assign(new Error("Unauthorized user"), { statusCode: 401 });
  }

  /* ================= FIND ORDER (ownership enforced) ================= */
  const order = await Order.findOne({ orderId, user: currentUser._id });
  if (!order) {
    throw Object.assign(new Error("Order not found"), { statusCode: 404 });
  }

  /* ================= FIND RETURN REQUEST ================= */
  const returnRequest = order.returnRequests.find(
    (r) => r.requestId?.toString() === requestId?.toString()
  );
  if (!returnRequest) {
    throw new Error("Return request not found");
  }
  if (returnRequest.status !== "pending") {
    throw new Error("Only pending requests can be updated");
  }
  if (!Array.isArray(returnItems)) {
    throw new Error("returnItems must be an array");
  }

  /* ================= VALIDATE ITEMS ================= */
  const validatedItems = [];
  for (const item of returnItems) {
    const { productId, variantId, quantity, reason } = item;
    if (!productId || !variantId || !quantity || Number(quantity) <= 0) {
      throw new Error("Invalid return item data");
    }
    const orderItem = order.items.find(
      (o) =>
        o.productId?.toString() === productId?.toString() &&
        o.variantId?.toString() === variantId?.toString()
    );
    if (!orderItem) {
      throw new Error("Product not found in order");
    }
    const maxAllowedQty = Number(orderItem.quantity);
    if (Number(quantity) > maxAllowedQty) {
      throw new Error(`Return quantity exceeds ordered quantity for ${orderItem.productName}`);
    }
    if (orderItem.price == null || Number(orderItem.price) <= 0) {
      throw new Error(`Invalid price found in order for ${orderItem.productName}`);
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
    console.error("Notification failed on return request update:", err.message);
  }

  return {
    orderId,
    requestId,
    items: validatedItems,
  };
};

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

export const updateReturnRequestStatusService = async (data) => {
  const { orderId, requestId, status, items, permission, userEmail } = data;

  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    /* ---------- FETCH EMPLOYEE ---------- */
    const employee = await Employee.findOne({ email: userEmail }).session(session);

    if (!employee) {
      throw new Error("Employee not found");
    }

    /* ---------- FETCH ORDER ---------- */
    const order = await Order.findOne({ orderId }).populate("user").session(session);

    if (!order) {
      throw new Error("Order not found");
    }

    /* ---------- FIND RETURN REQUEST ---------- */
    const returnRequest = order.returnRequests.find((r) => r.requestId === requestId);

    if (!returnRequest) {
      throw new Error("Return request not found");
    }

    if (returnRequest.status !== "pending") {
      throw new Error("Request already processed");
    }

    const stockProducts = [];

    /* ================= APPROVED ================= */
    if (status === "approved") {
      if (!Array.isArray(items) || items.length === 0) {
        throw new Error("Approved items required");
      }

      for (const approvedItem of items) {
        const { productId, variantId, approvedQuantity } = approvedItem;

        if (!approvedQuantity || approvedQuantity <= 0) {
          throw new Error("Invalid approved quantity");
        }

        const requestedItem = returnRequest.items.find(
          (i) => i.productId == productId && i.variantId == variantId
        );

        if (!requestedItem) {
          throw new Error("Item not found in return request");
        }
        if (approvedQuantity > requestedItem.quantity) {
          throw new Error("Approved quantity exceeds requested quantity");
        }

        const orderItem = order.items.find(
          (o) => o.productId == productId && o.variantId == variantId
        );

        if (!orderItem) continue;

        const alreadyReturned = orderItem.returnedQuantity || 0;
        const totalOrderedQuantity = orderItem.quantity + alreadyReturned;
        if (alreadyReturned + approvedQuantity > totalOrderedQuantity) {
          throw new Error("Return quantity exceeds allowed limit");
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
      const returnedQuantity = order.items.reduce(
        (sum, item) => sum + (item.returnedQuantity || 0),
        0
      );

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
      console.error("Notification failed on return status update:", err.message);
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

export const updateCourierDetailsService = async (data) => {
  const { orderId, corourseServiceName, DOCNumber, permission, userEmail } = data;

  /* ---------- FETCH EMPLOYEE ---------- */
  const employee = await Employee.findOne({ email: userEmail });

  if (!employee) {
    throw new Error("Employee not found");
  }

  /* ---------- FETCH ORDER ---------- */
  const order = await Order.findOne({ orderId }).populate("user");

  if (!order) {
    throw new Error("Order not found");
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