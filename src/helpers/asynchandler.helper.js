/**
 * asyncHandler(): the ONE try/catch for every controller. It runs the handler and passes any
 * thrown error to the global error middleware (middlewares/error.middleware.js).
 * Controllers therefore never write their own try/catch.
 *
 * Example:
 *   export const getBrand = asyncHandler(async (req, res) => {
 *     const brand = await getBrandByIdService(req.params.brandId);
 *     return sendSuccess(res, { data: brand, message: "Brand fetched" });
 *   });
 *
 * Used by: every controller
 */

/**
 * Wraps an async Express handler so a rejected promise or thrown error reaches next(error).
 *
 * @param {(req: import("express").Request, res: import("express").Response, next: Function) => Promise<unknown>} handler
 * @returns {import("express").RequestHandler}
 */
export const asyncHandler = (handler) =>
  async function asyncHandlerWrapper(req, res, next) {
    try {
      return await handler(req, res, next);
    } catch (error) {
      return next(error);
    }
  };
