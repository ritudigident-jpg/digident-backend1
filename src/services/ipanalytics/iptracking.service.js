/**
 * Business logic for API usage per IP address per month. Throws AppError subclasses on failure.
 *
 * Exports: lookupGeo, recordIpHit
 * Used by: middlewares/ipanalytics.middleware.js
 */

/**
 * Records one API hit per client IP per month (the data behind the IP analytics screens).
 * Runs AFTER the response has been sent, so it never slows a request down or fails it.
 * Geo data comes from ip-api.com and is cached in Redis for GEO_CACHE_SECONDS per IP, so each IP
 * is looked up at most once a week instead of on every request.
 *
 * Used by: middlewares/ipanalytics.middleware.js
 */
import axios from "axios";
import IpMonthlyAnalytics from "../../models/ipdailyanalytics.model.js";
import { redis } from "../../config/redis.config.js";
import { logger } from "../../helpers/logger.helper.js";

// TODO(team, 2026-11-01): ip-api.com's free plan is HTTP only. Switching to HTTPS needs the paid
// plan or another provider; decide which before changing GEO_LOOKUP_URL.
const GEO_LOOKUP_URL = "http://ip-api.com/json";
const GEO_FIELDS = "status,continent,country,countryCode,regionName,city,zip,lat,lon,timezone,currency";
const GEO_TIMEOUT_MS = 1500;
const GEO_CACHE_SECONDS = 7 * 24 * 60 * 60;
const geoCacheKey = (ip) => `geoip:${ip}`;

/**
 * Geo information for an IP (cached). Returns null when the lookup fails.
 *
 * @param {string} ip
 * @returns {Promise<object|null>} { continent, country, countryCode, regionName, city, zip, lat, lon, timezone, currency }
 */
export const lookupGeo = async (ip) => {
  try {
    const cached = await redis.get(geoCacheKey(ip));
    if (cached) return cached;
  } catch (error) {
    logger.warn("Geo cache read failed", { ip, error: error.message });
  }
  try {
    const { data } = await axios.get(`${GEO_LOOKUP_URL}/${ip}?fields=${GEO_FIELDS}`, {
      timeout: GEO_TIMEOUT_MS,
    });
    const geo = data?.status === "success" ? data : null;
    if (geo) await redis.set(geoCacheKey(ip), geo, { ex: GEO_CACHE_SECONDS }).catch(() => undefined);
    return geo;
  } catch (error) {
    logger.debug("Geo lookup failed", { ip, error: error.message });
    return null;
  }
};

/**
 * Adds one hit for this IP and endpoint to the current month (creates the records when needed).
 * Example: GET /api/v1/product/all from 1.2.3.4 in Oct 2026 -> monthlyStats["2026-10"].hitCount + 1
 * and endpoints["GET /api/v1/product/all"] + 1.
 *
 * @param {string} ip
 * @param {string} endpoint "METHOD /path"
 * @param {Date} [hitAt=new Date()]
 * @returns {Promise<void>}
 */
export const recordIpHit = async (ip, endpoint, hitAt = new Date()) => {
  const month = hitAt.toISOString().slice(0, 7); // YYYY-MM
  const geo = (await lookupGeo(ip)) || {};

  await IpMonthlyAnalytics.updateOne({ ip }, { $setOnInsert: { ip, monthlyStats: [] } }, { upsert: true });
  await IpMonthlyAnalytics.updateOne(
    { ip, "monthlyStats.month": { $ne: month } },
    { $push: { monthlyStats: { month, hitCount: 0, endpoints: {}, firstHitAt: hitAt, lastHitAt: hitAt } } }
  );
  await IpMonthlyAnalytics.updateOne(
    { ip },
    {
      $set: {
        continent: geo.continent,
        country: geo.country,
        countryCode: geo.countryCode,
        regionName: geo.regionName,
        city: geo.city,
        zip: geo.zip,
        lat: geo.lat,
        lon: geo.lon,
        timezone: geo.timezone,
        currency: geo.currency,
        "monthlyStats.$[m].lastHitAt": hitAt,
      },
      $inc: { "monthlyStats.$[m].hitCount": 1, [`monthlyStats.$[m].endpoints.${endpoint}`]: 1 },
    },
    { arrayFilters: [{ "m.month": month }] }
  );
};
