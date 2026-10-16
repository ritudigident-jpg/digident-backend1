/**
 * Gives every request an id: the incoming x-request-id header (when it looks safe) or a new UUID.
 * The id is on req.id, sent back in the x-request-id response header and in every error body,
 * and written in every log line, so one failing request can be found in the logs.
 *
 * Used by: app.js
 */
import { randomUUID } from "node:crypto";

const SAFE_ID = /^[\w-]{8,100}$/;

/** @type {import("express").RequestHandler} */
export const requestIdMiddleware = (req, res, next) => {
  const incoming = req.get("x-request-id");
  req.id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.set("x-request-id", req.id);
  next();
};
