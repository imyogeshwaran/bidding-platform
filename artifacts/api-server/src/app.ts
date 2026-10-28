import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { persistResponseState } from "./repositories/mongo-store";
import { createId, recordRequest, userActivity } from "./repositories/memory-store";
import { saveRequestSample, saveUserActivity } from "./repositories/mongo-store";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

app.use((request, response, next) => {
  const startedAt = performance.now();
  response.once("finish", () => {
    const authUser = response.locals.authUser as { id: string } | undefined;
    const sample = {
      id: createId(),
      method: request.method,
      endpoint: request.path,
      statusCode: response.statusCode,
      durationMs: Math.max(0, Number((performance.now() - startedAt).toFixed(2))),
      timestamp: Date.now(),
      ...(authUser ? { userId: authUser.id } : {}),
    };
    recordRequest(sample);
    const meaningfulAction =
      authUser &&
      ["POST", "PUT", "PATCH", "DELETE"].includes(request.method);
    if (meaningfulAction) {
      const activity = { userId: authUser.id, timestamp: sample.timestamp };
      userActivity.push(activity);
      void Promise.all([saveRequestSample(sample), saveUserActivity(activity.userId, activity.timestamp)])
        .catch((err: unknown) => logger.error({ err }, "Failed to persist request metrics"));
      return;
    }
    void saveRequestSample(sample).catch((err: unknown) => {
      logger.error({ err }, "Failed to persist request metrics");
    });
  });
  next();
});

app.use((request, response, next) => {
  const sendJson = response.json.bind(response);
  const sendStatus = response.sendStatus.bind(response);
  response.json = ((body: unknown) => {
    if (
      response.locals.bidStatePersisted === true ||
      (response.statusCode >= 400 &&
        response.locals.persistStateOnError !== true) ||
      response.locals.skipStatePersistence === true ||
      request.method === "GET" ||
      request.method === "HEAD"
    ) {
      sendJson(body);
      return response;
    }
    void persistResponseState()
      .then(() => sendJson(body))
      .catch((err: unknown) => {
        logger.error({ err }, "Failed to persist response state");
        response.statusCode = 503;
        sendJson({ success: false, error: { code: "PERSISTENCE_ERROR", message: "The request could not be saved. Please retry." } });
      });
    return response;
  }) as typeof response.json;
  response.sendStatus = ((statusCode: number) => {
    if (response.locals.skipStatePersistence === true) {
      sendStatus(statusCode);
      return response;
    }
    void persistResponseState()
      .then(() => sendStatus(statusCode))
      .catch((err: unknown) => {
        logger.error({ err }, "Failed to persist response state");
        response.statusCode = 503;
        sendJson({ success: false, error: { code: "PERSISTENCE_ERROR", message: "The request could not be saved. Please retry." } });
      });
    return response;
  }) as typeof response.sendStatus;
  next();
});

app.use("/api", router);

export default app;
