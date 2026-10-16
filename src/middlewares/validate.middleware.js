/**
 * validate(schema, source): checks req.body / req.query / req.params with a Joi schema before the
 * controller runs. On failure it sends the standard 400 VALIDATION_ERROR with one detail per field.
 * On success the cleaned value replaces the original (unknown keys removed).
 *
 * Example (route file):
 *   router.post("/create", validate(createBrandSchema), createBrand);
 *   router.get("/:brandId", validateObjectIdParams("brandId"), getBrand);
 *
 * Used by: route files
 */
import Joi from "joi";
import { ValidationError } from "../helpers/apperror.helper.js";

const JOI_OPTIONS = { abortEarly: false, stripUnknown: true, convert: true };
const OBJECT_ID = /^[a-f\d]{24}$/i;

/** Joi rule for a MongoDB ObjectId string. */
export const objectId = () =>
  Joi.string()
    .pattern(OBJECT_ID, "MongoDB ObjectId")
    .messages({ "string.pattern.name": "{{#label}} must be a valid id" });

/**
 * Validates one part of the request.
 *
 * @param {import("joi").Schema} schema
 * @param {"body" | "query" | "params"} [source="body"]
 * @returns {import("express").RequestHandler}
 */
export const validate =
  (schema, source = "body") =>
  (req, res, next) => {
    const { value, error } = schema.validate(req[source] ?? {}, JOI_OPTIONS);
    if (error) return next(ValidationError.fromJoi(error));
    // Express 5: req.query is a getter that re-parses the URL, so shadow it with the cleaned value.
    Object.defineProperty(req, source, { value, writable: true, configurable: true, enumerable: true });
    return next();
  };

/**
 * Checks that the named route params are valid ObjectIds (400 instead of a Mongoose CastError).
 *
 * @param {...string} names Param names, e.g. "orderId".
 * @returns {import("express").RequestHandler}
 */
export const validateObjectIdParams = (...names) => {
  const schema = Joi.object(Object.fromEntries(names.map((name) => [name, objectId().required()]))).unknown(
    true
  );
  return (req, res, next) => {
    const { error } = schema.validate(req.params, { abortEarly: false });
    return next(error ? ValidationError.fromJoi(error, "Invalid id") : undefined);
  };
};
