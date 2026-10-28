import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import { resolve } from "node:path";

dotenv.config({
  path: process.env.DOTENV_CONFIG_PATH ?? resolve(process.cwd(), "../../.env"),
});

if (!process.argv.includes("--confirm-demo-data-removal")) {
  throw new Error("Pass --confirm-demo-data-removal to delete the known demo fixtures.");
}

const uri = process.env.MONGODB_URI?.trim();
if (!uri) {
  throw new Error("MONGODB_URI is required to remove demo records.");
}

const auctionIds = ["camera-01", "watch-01", "vase-01", "chair-01"];
const sampleBidderIds = ["sample-buyer-one", "sample-buyer-two", "sample-buyer-three"];
const client = new MongoClient(uri, { appName: "bidding-platform-demo-cleanup" });

try {
  await client.connect();
  const database = client.db(process.env.MONGODB_DB_NAME?.trim() || undefined);
  const session = client.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      const auctions = await database.collection("auctions").deleteMany(
        { _id: { $in: auctionIds } },
        { session },
      );
      const bids = await database.collection("bids").deleteMany(
        { "value.auctionId": { $in: auctionIds } },
        { session },
      );
      const transactions = await database.collection("transactions").deleteMany(
        { "value.auctionId": { $in: auctionIds } },
        { session },
      );
      const notifications = await database.collection("notifications").deleteMany(
        { "value.auctionId": { $in: auctionIds } },
        { session },
      );
      const activities = await database.collection("activities").deleteMany({
        $or: [
          {
            "value.title": "Auction completed",
            "value.detail": "Mid-Century Teak Lounge Chair closed at $810",
          },
          {
            "value.title": "New listing",
            "value.detail": "1968 Rangefinder Film Camera is live",
          },
        ],
      }, { session });
      const userActivity = await database.collection("userActivity").deleteMany(
        { userId: { $in: sampleBidderIds } },
        { session },
      );
      const watchlists = await database.collection("watchlists").updateMany(
        { auctionIds: { $in: auctionIds } },
        { $pull: { auctionIds: { $in: auctionIds } } },
        { session },
      );

      result = {
        auctions: auctions.deletedCount,
        bids: bids.deletedCount,
        transactions: transactions.deletedCount,
        notifications: notifications.deletedCount,
        activities: activities.deletedCount,
        userActivity: userActivity.deletedCount,
        watchlistsUpdated: watchlists.modifiedCount,
      };
    });
  } finally {
    await session.endSession();
  }

  console.log(JSON.stringify({ database: database.databaseName, removed: result }, null, 2));
} finally {
  await client.close();
}
