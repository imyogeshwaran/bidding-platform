import "dotenv/config";
import { createServer } from "node:http";
import app from "./app";
import { logger } from "./lib/logger";
import { attachRealtime, publishAuctionUpdate } from "./lib/realtime";
import { persistResponseState, connectDatabase } from "./repositories/mongo-store";
import { processScheduledAuctions } from "./routes/auctions";
import { seedMetricsDemoData } from "./services/metrics-demo-data";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function startServer(): Promise<void> {
  await connectDatabase();
  if (
    process.env["NODE_ENV"] === "development" &&
    process.env["METRICS_DEMO_MODE"] === "true"
  ) {
    const seededAuctions = seedMetricsDemoData();
    logger.info(
      { seededAuctions },
      "Local in-memory software metrics demo data enabled; demo records will not be persisted",
    );
  }
  const server = createServer(app);
  attachRealtime(server);

  server.on("error", (err) => {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  });
  server.listen(port, () => {
    logger.info({ port }, "Server listening");
    setInterval(() => {
      const changedAuctions = processScheduledAuctions();
      if (changedAuctions.length === 0) return;

      void persistResponseState()
        .then(() => {
          for (const auction of changedAuctions) {
            publishAuctionUpdate(auction.id, { auctionId: auction.id, auction });
          }
        })
        .catch((err: unknown) => {
          logger.error({ err }, "Failed to persist scheduled auction updates");
        });
    }, 1000);
  });
}

void startServer().catch((err: unknown) => {
  logger.error({ err }, "Failed to start API server because database initialization failed");
  process.exitCode = 1;
});
