import express from "express";
import dotenv from "dotenv";
import passport from "passport";
import connectDB from "./src/config/db.config.js";
import userRoutes from "./src/routes/ecommarace/user.routes.js";
import setupPassport from "./src/config/passport.js";
import cookieParser from "cookie-parser";

import addressRoutes from "./src/routes/ecommarace/address.routes.js";
import employeeRoutes from "./src/routes/manage/employee.routes.js";
import brandRoutes from "./src/routes/manage/brand.routes.js";
import categoryRoutes from "./src/routes/manage/category.routes.js";
import contactRoutes from "./src/routes/ecommarace/contact.routes.js";
import couponRoutes from "./src/routes/manage/coupon.routes.js";
import bannerRoutes from "./src/routes/manage/banner.routes.js";
import cartRoutes from "./src/routes/ecommarace/cart.routes.js";
import ipAnalyticsRoutes from "./src/routes/manage/ipanalytic.routes.js";
import viedoRoutes from "./src/routes/manage/video.routes.js";
import reviewRoutes from "./src/routes/ecommarace/review.routes.js"
import productRoutes from "./src/routes/manage/product.routes.js"
import zohoRoutes from "./src/routes/zoho/zoho.routes.js"
import stockAudit from "./src/routes/ecommarace/stockauditlog.routes.js"
import permissionRoutes from "./src/routes/manage/permission.routes.js"
import orderRoutes from "./src/routes/ecommarace/order.routes.js"
import oauthRouter from "./src/routes/zoho/auth.routes.js"
import librarylogRoutes from "./src/routes/ecommarace/librarylog.routes.js"
import awsUploadRoutes from "./src/routes/ecommarace/aws.routes.js"

dotenv.config();

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(passport.initialize());

setupPassport();

/* -------------------------------
   HEALTH CHECK ROUTE
-------------------------------- */

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Server is running successfully 🚀",
  });
});


/* ===================== 📍 DATA ENRICHMENT ENGINE ===================== */

app.use(async (req, res, next) => {
  let ip =
    req.headers["x-forwarded-for"]?.split(",")[0] ||
    req.socket.remoteAddress ||
    req.ip;

  if (ip === "::1" || ip === "127.0.0.1") {
    ip = "163.53.179.27";
  }

  req.userIP = ip;

  try {
    const fields =
      "status,continent,country,countryCode,regionName,city,zip,lat,lon,timezone,currency";

    const { data } = await axios.get(
      `http://ip-api.com/json/${ip}?fields=${fields}`,
      { timeout: 1500 }
    );

    req.geoIpApi = data.status === "success" ? data : null;
  } catch {
    req.geoIpApi = null;
  }

  next();
});

/* -------------------------------
   USER ROUTES
-------------------------------- */
app.use("/oauth", oauthRouter);
app.use("/api", zohoRoutes);
app.use("/api/v1/user", userRoutes);
app.use("/api/v1/user/address", addressRoutes);
app.use("/api/v1/brand", brandRoutes);
app.use("/api/v1/employee", employeeRoutes);
app.use("/api/v1/category", categoryRoutes);
app.use("/api/v1/contact", contactRoutes);
app.use("/api/v1/coupons", couponRoutes);
app.use("/api/v1/banner", bannerRoutes);
app.use("/api/v1/cart", cartRoutes);
app.use("/api/v1/ipAnalytics", ipAnalyticsRoutes);
app.use("/api/v1/viedo", viedoRoutes);
app.use("/api/v1/rating", reviewRoutes);
app.use("/api/v1/product", productRoutes);
app.use("/api/v1/stock-audit",stockAudit)
app.use("/api/v1/permission", permissionRoutes);
app.use("/api/v1/order", orderRoutes);
app.use("/api/v1/libarylog", librarylogRoutes);
app.use("/api/v1/aws", awsUploadRoutes);
/* -------------------------------
   START SERVER
-------------------------------- */

const startServer = async () => {
  try {
    await connectDB();

    const PORT = process.env.PORT || 3000;

    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });

  } catch (error) {
    console.error("Database connection failed:", error);
  }
};

startServer();