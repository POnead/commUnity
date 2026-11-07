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

  router.use("/api/auth", dispatch);
  router.use("/api/reports", dispatch);
  router.use("/api/report-photos", dispatch);
  router.use("/api/settings", dispatch);
  router.use("/api/locations", dispatch);
  router.use("/api/announcements", dispatch);
  router.use("/api/profile", dispatch);
  router.use("/api/session", dispatch);
  router.use("/api/state", dispatch);
  router.use("/api/users", dispatch);
  router.use("/api", dispatch);
  return router;
}
