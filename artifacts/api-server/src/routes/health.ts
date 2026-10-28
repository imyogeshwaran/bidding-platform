import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { pingDatabase } from "../repositories/mongo-store";

const router: IRouter = Router();

router.get("/healthz", async (_req, res): Promise<void> => {
  try {
    await pingDatabase();
    res.json(HealthCheckResponse.parse({ status: "ok" }));
  } catch (err) {
    logger.error({ err }, "Health check failed because MongoDB is unavailable");
    res.status(503).json(HealthCheckResponse.parse({ status: "degraded" }));
  }
});

export default router;
