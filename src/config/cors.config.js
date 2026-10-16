/**
 * Which browser origins may call the API (CORS and Socket.IO).
 * Add a permanent site to DEFAULT_ORIGINS; add a temporary one with the CORS_ORIGINS env variable
 * (comma separated). CLIENT_URL is always allowed.
 *
 * Used by: app.js, config/socket.config.js (through app.js)
 */
const DEFAULT_ORIGINS = [
  // local development
  "http://localhost:4000",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "http://localhost:8081",
  "http://localhost:8082",
  // production
  "https://digident.in",
  "https://shop.digident.in",
  "https://manage.digident.in",
  "https://library.digident.in",
  "https://backend-5mo5.onrender.com",
  // preview / beta builds
  "https://digident-beta.netlify.app",
  "https://manage-beta.netlify.app",
  "https://digident-ecommerce-beta.netlify.app",
  "https://adminfrontend00.netlify.app",
  "https://frontendmaindigi.netlify.app",
  "https://ecommercedigi.netlify.app",
  "https://coruscating-alpaca-89429f.netlify.app",
  "https://ordermange.netlify.app",
];

/**
 * The de-duplicated list of allowed origins.
 *
 * @param {NodeJS.ProcessEnv} [source=process.env]
 * @returns {string[]}
 */
export const getAllowedOrigins = (source = process.env) => {
  const extra = (source.CORS_ORIGINS || "").split(",").map((origin) => origin.trim());
  return [...new Set([...DEFAULT_ORIGINS, ...extra, source.CLIENT_URL].filter(Boolean))];
};

/**
 * Options for the cors() middleware. Requests without an Origin header (mobile apps, curl,
 * server-to-server) are allowed; other origins outside the list get 403 CORS_BLOCKED.
 *
 * @param {string[]} allowedOrigins
 * @returns {import("cors").CorsOptions}
 */
export const buildCorsOptions = (allowedOrigins) => ({
  origin: (origin, callback) =>
    !origin || allowedOrigins.includes(origin) ? callback(null, true) : callback(new Error("CORS Blocked")),
  credentials: true,
});
