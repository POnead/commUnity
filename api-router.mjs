import express from "express";

function createDomainDispatcher(handleApi, context) {
  return async (request, response, next) => {
    const originalUrl = request.url;
    request.url = request.originalUrl || request.url;
    try {
      const { db, ...options } = context;
      await handleApi(request, response, db, { ...options, server: request.socket.server });
    } catch (error) {
      next(error);
    } finally {
      request.url = originalUrl;
    }
  };
}

export function createApiRouter({ handleApi, context }) {
  const router = express.Router();
  const dispatch = createDomainDispatcher(handleApi, context);

  // One dispatcher for every /api path. The domain handlers decide which endpoint
  // they own and return 404 for the rest.
  router.use("/api", dispatch);
  return router;
}
