/**
 * Loads environment variables ONCE (".env", then ".env.<NODE_ENV>" for anything not set yet) and
 * checks them at startup. A missing required variable stops the server with a clear message
 * instead of failing later on the first request.
 * Must be the first import of app.js, because other config files read process.env when loaded.
 *
 * Used by: app.js
 */
import dotenv from "dotenv";
import Joi from "joi";

dotenv.config({ quiet: true });
dotenv.config({ path: `.env.${process.env.NODE_ENV || "development"}`, quiet: true });

const optionalText = Joi.string().allow("");

const schema = Joi.object({
  NODE_ENV: Joi.string().valid("development", "production", "test", "staging").default("development"),
  PORT: Joi.number().port().default(3000),
  LOG_LEVEL: Joi.string().valid("debug", "info", "warn", "error", "silent"),

  MONGODB_URI: Joi.string().required(),
  ACCESS_TOKEN_SECRET: Joi.string().required(),
  REFRESH_TOKEN_SECRET: Joi.string().required(),
  UPSTASH_REDIS_REST_URL: Joi.string().uri().required(),
  UPSTASH_REDIS_REST_TOKEN: Joi.string().required(),

  CLIENT_URL: optionalText,
  FRONTEND_URL: optionalText,
  CORS_ORIGINS: optionalText.description("Extra allowed origins, comma separated"),
  APP_NAME: optionalText,
  ADMIN_EMAIL: optionalText,

  AWS_ACCESS_KEY: optionalText,
  AWS_SECRET_KEY: optionalText,
  AWS_REGION: optionalText,
  AWS_S3_BUCKET: optionalText,

  RAZORPAY_KEY_ID: optionalText,
  RAZORPAY_KEY_SECRET: optionalText,
  RAZORPAY_WEBHOOK_SECRET: optionalText,

  GOOGLE_CLIENT_ID: optionalText,
  GOOGLE_CLIENT_SECRET: optionalText,
  GOOGLE_CALLBACK_URL: optionalText,
  MICROSOFT_CLIENT_ID: optionalText,
  MICROSOFT_CLIENT_SECRET: optionalText,
  MICROSOFT_CALLBACK_URL: optionalText,

  ZOHO_CLIENT_ID: optionalText,
  ZOHO_CLIENT_SECRET: optionalText,
  ZOHO_REDIRECT_URI: optionalText,
  ZOHO_REFRESH_TOKEN: optionalText,
  ZOHO_ACCOUNT_ID: optionalText,
  ZOHO_EMAIL: optionalText,
  ZOHO_WEBHOOK_SECRET: optionalText,
}).unknown(true);

/**
 * Validates process.env. Returns the checked values, or throws with every problem listed.
 *
 * @param {NodeJS.ProcessEnv} [source=process.env]
 * @returns {object} Validated environment (defaults applied).
 */
export const validateEnv = (source = process.env) => {
  const { value, error } = schema.validate(source, { abortEarly: false });
  if (error) {
    const problems = error.details.map((detail) => detail.message).join("; ");
    throw new Error(`Invalid environment configuration: ${problems}`);
  }
  return value;
};

export const env = (() => {
  try {
    return validateEnv();
  } catch (error) {
    if (process.env.NODE_ENV === "test") return process.env;
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
    return undefined;
  }
})();
