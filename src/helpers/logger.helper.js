/**
 * Small structured logger (one JSON line per entry in production, readable lines in development).
 * Use it instead of console.*. Secrets are removed before anything is written.
 *
 * Example:
 *   logger.error("Order create failed", { requestId: req.id, orderId, error });
 *   -> {"level":"error","time":"2026-10-16T04:00:00.000Z","msg":"Order create failed","requestId":"…",…}
 *
 * Used by: the whole backend
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const SECRET_KEYS = /pass(word)?|token|secret|otp|authorization|cookie|api[-_]?key|signature/i;
const MAX_DEPTH = 4;

const isProduction = () => process.env.NODE_ENV === "production";
const minimumLevel = () => LEVELS[process.env.LOG_LEVEL] ?? (isProduction() ? LEVELS.info : LEVELS.debug);

/**
 * Copy of a value that is safe to log: secrets masked, errors turned into plain objects.
 *
 * @param {*} value
 * @param {number} [depth=0]
 * @returns {*}
 */
export const redact = (value, depth = 0) => {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      code: value.code,
      statusCode: value.statusCode,
      stack: value.stack,
      cause: value.cause ? redact(value.cause, depth + 1) : undefined,
    };
  }
  if (!value || typeof value !== "object" || depth >= MAX_DEPTH) return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SECRET_KEYS.test(key) ? "[REDACTED]" : redact(item, depth + 1),
    ])
  );
};

const write = (level, message, context = {}) => {
  if (LEVELS[level] < minimumLevel()) return;
  const entry = { level, time: new Date().toISOString(), msg: message, ...redact(context) };
  const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;
  if (isProduction()) {
    stream.write(`${JSON.stringify(entry)}\n`);
    return;
  }
  const { level: _level, time, msg, ...rest } = entry;
  const extra = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : "";
  stream.write(`${time} ${level.toUpperCase()} ${msg}${extra}\n`);
};

export const logger = {
  /** Detail for developers; hidden in production unless LOG_LEVEL=debug. */
  debug: (message, context) => write("debug", message, context),
  /** Normal events (server started, job finished). */
  info: (message, context) => write("info", message, context),
  /** Something odd that did not break the request. */
  warn: (message, context) => write("warn", message, context),
  /** A failure. Pass the error as `error` so the stack is kept. */
  error: (message, context) => write("error", message, context),
};

export default logger;
