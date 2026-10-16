/**
 * Upstash Redis client (REST based, so there is no connection to open or close).
 * app.js checks it with redis.ping() at startup.
 *
 * Used by: app.js, services that cache data
 */
import { Redis } from "@upstash/redis";

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
