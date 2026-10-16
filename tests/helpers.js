/**
 * Test doubles for Express request / response objects.
 */

/** A response object that records what the handler sent. */
export const createResponse = () => {
  const res = {
    statusCode: 200,
    body: undefined,
    headers: {},
    headersSent: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      this.headersSent = true;
      return this;
    },
    set(name, value) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
  };
  return res;
};

/** A minimal request object. */
export const createRequest = (overrides = {}) => ({
  id: "test-request-id",
  method: "GET",
  originalUrl: "/api/v1/test",
  headers: {},
  get(name) {
    return this.headers[name.toLowerCase()];
  },
  ...overrides,
});
