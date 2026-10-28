import { MongoClient, type Collection, type Document, type Db } from "mongodb";
import {
  activities,
  auctions,
  bids,
  notifications,
  normalizeUserRole,
  requestSamples,
  transactions,
  userActivity,
  users,
  watchlists,
  type ActivityRecord,
  type AuctionRecord,
  type BidRecord,
  type NotificationRecord,
  type RequestSample,
  type TransactionRecord,
  type UserRecord,
} from "./memory-store";
import { METRICS_DEMO_ID_PREFIX } from "../services/metrics-demo-data";

interface Stored<T> extends Document {
  _id: string;
  value: T;
}

interface StoredWatchlist extends Document {
  _id: string;
  userId: string;
  auctionIds: string[];
}

interface StoredAuction extends Stored<AuctionRecord> {
  bidderIds?: string[];
}

interface StoredUserActivity extends Document {
  _id: string;
  userId: string;
  timestamp: number;
}

let client: MongoClient | undefined;
let database: Db | undefined;
let persistenceQueue: Promise<void> = Promise.resolve();

function getDatabase(): Db {
  if (!database) throw new Error("MongoDB is not connected.");
  return database;
}

export async function pingDatabase(): Promise<void> {
  await getDatabase().command({ ping: 1 });
}

function records<T>(name: string): Collection<Stored<T>> {
  return getDatabase().collection<Stored<T>>(name);
}

function auctionRecords(): Collection<StoredAuction> {
  return getDatabase().collection<StoredAuction>("auctions");
}

async function loadRecords<T extends { id: string }>(name: string): Promise<T[]> {
  const stored = await records<T>(name).find({}, { projection: { value: 1 } }).toArray();
  return stored.map((item) => item.value);
}

async function saveRecord<T extends { id: string }>(name: string, record: T): Promise<void> {
  await records<T>(name).replaceOne(
    { _id: record.id },
    { _id: record.id, value: record },
    { upsert: true },
  );
}

async function persistCurrentState(): Promise<void> {
  const isPersistableId = (id: string | undefined) =>
    !id?.startsWith(METRICS_DEMO_ID_PREFIX);
  await Promise.all([
    ...users.filter((record) => isPersistableId(record.id)).map((record) => saveUser(record)),
    ...auctions.filter((record) => isPersistableId(record.id)).map((record) => saveAuction(record)),
    ...bids.filter((record) => isPersistableId(record.id)).map((record) => saveBid(record)),
    ...notifications.filter((record) => isPersistableId(record.id)).map((record) => saveNotification(record)),
    ...transactions.filter((record) => isPersistableId(record.id)).map((record) => saveTransaction(record)),
    ...activities.filter((record) => isPersistableId(record.id)).map((record) => saveActivity(record)),
    ...userActivity
      .filter((record) => isPersistableId(record.userId))
      .map((record) => saveUserActivity(record.userId, record.timestamp)),
    ...requestSamples
      .filter((record) => isPersistableId(record.id))
      .map((record) => saveRequestSample(record)),
    ...[...watchlists].map(([userId, ids]) => saveWatchlist(userId, ids)),
  ]);
}

export function persistResponseState(): Promise<void> {
  const current = persistenceQueue.then(() => persistCurrentState());
  persistenceQueue = current.catch(() => undefined);
  return current;
}

function replaceArray<T>(target: T[], items: T[]): void {
  target.splice(0, target.length, ...items);
}

export async function connectDatabase(): Promise<void> {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) throw new Error("MONGODB_URI is required. Copy .env.example to .env and configure MongoDB Atlas.");

  client = new MongoClient(uri, {
    appName: "bidding-platform-api",
    serverSelectionTimeoutMS: 10_000,
  });
  await client.connect();
  database = client.db(process.env.MONGODB_DB_NAME?.trim() || undefined);

  await Promise.all([
    records<UserRecord>("users").createIndex({ "value.email": 1 }, { unique: true }),
    auctionRecords().createIndex({ "value.status": 1, "value.endAt": 1 }),
    records<BidRecord>("bids").createIndex({ "value.auctionId": 1, "value.placedAt": -1 }),
    records<NotificationRecord>("notifications").createIndex({ "value.userId": 1, "value.createdAt": -1 }),
    records<TransactionRecord>("transactions").createIndex({ "value.auctionId": 1 }, { unique: true, sparse: true }),
    records<TransactionRecord>("transactions").createIndex({ "value.transactionDeadlineAt": 1 }),
    records<ActivityRecord>("activities").createIndex({ "value.createdAt": -1 }),
    records<AuctionRecord>("auctions").createIndex({ "value.createdAt": 1, "value.endAt": 1 }),
    records<BidRecord>("bids").createIndex({ "value.placedAt": 1 }),
    records<RequestSample>("requestSamples").createIndex({ "value.timestamp": 1 }),
    getDatabase().collection<StoredWatchlist>("watchlists").createIndex({ userId: 1 }, { unique: true }),
    getDatabase().collection<StoredUserActivity>("userActivity").createIndex({ userId: 1, timestamp: -1 }),
  ]);

  const [persistedUsers, storedAuctions, storedBids, storedNotifications, storedTransactions, storedActivities, storedUserActivity, storedWatchlists, storedRequestSamples] = await Promise.all([
    loadRecords<UserRecord>("users"),
    loadRecords<AuctionRecord>("auctions"),
    loadRecords<BidRecord>("bids"),
    loadRecords<NotificationRecord>("notifications"),
    loadRecords<TransactionRecord>("transactions"),
    loadRecords<ActivityRecord>("activities"),
    getDatabase().collection<StoredUserActivity>("userActivity").find().toArray(),
    getDatabase().collection<StoredWatchlist>("watchlists").find().toArray(),
    records<RequestSample>("requestSamples").find({}, { projection: { value: 1 } }).toArray().then((items) => items.map((item) => item.value)),
  ]);

  const usersToMigrate: UserRecord[] = [];
  const storedUsers = persistedUsers.flatMap((record) => {
    const role = normalizeUserRole(record.role);
    if (!role) return [];
    const normalizedRecord = { ...record, role, isSuspended: record.isSuspended === true };
    if (role !== record.role || normalizedRecord.isSuspended !== record.isSuspended) {
      usersToMigrate.push(normalizedRecord);
    }
    return [normalizedRecord];
  });

  replaceArray(users, storedUsers);
  await Promise.all(usersToMigrate.map(saveUser));
  replaceArray(auctions, storedAuctions);
  replaceArray(bids, storedBids);
  replaceArray(notifications, storedNotifications);
  replaceArray(transactions, storedTransactions);
  replaceArray(activities, storedActivities);
  replaceArray(requestSamples, storedRequestSamples);
  replaceArray(userActivity, storedUserActivity.map(({ userId, timestamp }) => ({ userId, timestamp })));
  watchlists.clear();
  for (const watchlist of storedWatchlists) {
    watchlists.set(watchlist.userId, new Set(watchlist.auctionIds));
  }

}

export async function disconnectDatabase(): Promise<void> {
  await client?.close();
  client = undefined;
  database = undefined;
}

export const saveUser = (record: UserRecord) => saveRecord("users", record);
export async function saveAuction(record: AuctionRecord): Promise<void> {
  await auctionRecords().updateOne(
    { _id: record.id },
    [
      {
        $set: {
          // A queued whole-state snapshot must not overwrite a newer atomic bid.
          value: {
            $cond: [
              {
                $gt: [
                  { $ifNull: ["$value.bidCount", -1] },
                  record.bidCount,
                ],
              },
              "$value",
              { $literal: record },
            ],
          },
        },
      },
    ],
    { upsert: true },
  );
}
export const saveBid = (record: BidRecord) => saveRecord("bids", record);
export const saveNotification = (record: NotificationRecord) => saveRecord("notifications", record);
export const saveTransaction = (record: TransactionRecord) => saveRecord("transactions", record);
export const saveActivity = (record: ActivityRecord) => saveRecord("activities", record);

export async function persistBidSideEffects(
  bidNotifications: NotificationRecord[],
  activity: ActivityRecord,
  activityUser: { userId: string; timestamp: number },
): Promise<void> {
  await Promise.all([
    records<NotificationRecord>("notifications").bulkWrite(
      bidNotifications.map((notification) => ({
        replaceOne: {
          filter: { _id: notification.id },
          replacement: { _id: notification.id, value: notification },
          upsert: true,
        },
      })),
    ),
    saveActivity(activity),
    saveUserActivity(activityUser.userId, activityUser.timestamp),
  ]);
}

export async function readAuction(auctionId: string): Promise<AuctionRecord | null> {
  const record = await auctionRecords().findOne({ _id: auctionId });
  return record?.value ?? null;
}

export async function acceptBidAtomically(
  auctionId: string,
  expectedPrice: number,
  amount: number,
  bidderId: string,
  bid: BidRecord,
): Promise<AuctionRecord | null> {
  const session = client?.startSession();
  if (!session) throw new Error("MongoDB is not connected.");
  let updatedAuction: AuctionRecord | null = null;
  try {
    await session.withTransaction(async () => {
      const now = new Date().toISOString();
      const endingSoonAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const result = await auctionRecords().findOneAndUpdate(
        {
          _id: auctionId,
          "value.currentPrice": expectedPrice,
          "value.endAt": { $gt: now },
          "value.status": { $in: ["UPCOMING", "LIVE", "ENDING_SOON"] },
          $expr: { $gte: [amount, { $add: ["$value.currentPrice", "$value.increment"] }] },
        },
        [
          {
            $set: {
              "value.currentPrice": amount,
              "value.bidCount": { $add: ["$value.bidCount", 1] },
              "value.status": {
                $cond: [
                  { $gt: ["$value.startAt", now] },
                  "UPCOMING",
                  {
                    $cond: [
                      { $lte: ["$value.endAt", endingSoonAt] },
                      "ENDING_SOON",
                      "LIVE",
                    ],
                  },
                ],
              },
              "value.exitedBidderIds": {
                $setDifference: [{ $ifNull: ["$value.exitedBidderIds", []] }, [bidderId]],
              },
              bidderIds: { $setUnion: [{ $ifNull: ["$bidderIds", []] }, [bidderId]] },
              "value.uniqueBidders": {
                $size: { $setUnion: [{ $ifNull: ["$bidderIds", []] }, [bidderId]] },
              },
            },
          },
        ],
        { returnDocument: "after", session },
      );
      if (!result) return;
      updatedAuction = result.value;
      bid.sequence = result.value.bidCount;
      await records<BidRecord>("bids").insertOne(
        { _id: bid.id, value: bid },
        { session },
      );
    });
    return updatedAuction;
  } finally {
    await session.endSession();
  }
}

export type AuctionExitOutcome =
  | { kind: "EXITED"; auction: AuctionRecord; closed: boolean; winningBid: BidRecord | null }
  | { kind: "NOT_FOUND" | "CLOSED" | "NOT_PARTICIPANT" | "ALREADY_EXITED" | "LEADING" };

export async function exitAuctionAtomically(
  auctionId: string,
  bidderId: string,
): Promise<AuctionExitOutcome> {
  const session = client?.startSession();
  if (!session) throw new Error("MongoDB is not connected.");
  let outcome: AuctionExitOutcome = { kind: "NOT_FOUND" };
  try {
    await session.withTransaction(async () => {
      outcome = { kind: "NOT_FOUND" };
      const storedAuction = await auctionRecords().findOne({ _id: auctionId }, { session });
      if (!storedAuction) return;

      const auction = storedAuction.value;
      const now = Date.now();
      if (
        (auction.status !== "UPCOMING" &&
          auction.status !== "LIVE" &&
          auction.status !== "ENDING_SOON") ||
        Date.parse(auction.endAt) <= now
      ) {
        outcome = { kind: "CLOSED" };
        return;
      }

      const storedBids = await records<BidRecord>("bids")
        .find({ "value.auctionId": auctionId, "value.status": "ACCEPTED" }, { session })
        .toArray();
      const accepted = storedBids.map(({ value }) => value).sort(
        (left, right) =>
          right.amount - left.amount ||
          Date.parse(left.placedAt) - Date.parse(right.placedAt),
      );
      const participants = new Set(accepted.map((bid) => bid.bidderId));
      if (!participants.has(bidderId)) {
        outcome = { kind: "NOT_PARTICIPANT" };
        return;
      }

      const exited = new Set(auction.exitedBidderIds ?? []);
      if (exited.has(bidderId)) {
        outcome = { kind: "ALREADY_EXITED" };
        return;
      }

      const activeBids = accepted.filter((bid) => !exited.has(bid.bidderId));
      if (activeBids[0]?.bidderId === bidderId) {
        outcome = { kind: "LEADING" };
        return;
      }

      exited.add(bidderId);
      const remainingParticipants = [...participants].filter((id) => !exited.has(id));
      const closes = participants.size >= 2 && remainingParticipants.length === 1;
      const winnerId = closes ? remainingParticipants[0] : null;
      const winningBid = winnerId
        ? accepted.find((bid) => bid.bidderId === winnerId) ?? null
        : null;
      const exitedBidderIds = [...exited];
      const updates: Partial<AuctionRecord> = {
        exitedBidderIds,
        ...(closes
          ? {
              status: "COMPLETED" as const,
              finalizedAt: new Date(now).toISOString(),
              winnerId,
              currentPrice: winningBid?.amount ?? auction.startingPrice,
            }
          : {}),
      };
      const update = await auctionRecords().updateOne(
        {
          _id: auctionId,
          "value.status": { $in: ["UPCOMING", "LIVE", "ENDING_SOON"] },
          "value.endAt": { $gt: new Date(now).toISOString() },
        },
        {
          $set: Object.fromEntries(
            Object.entries(updates).map(([key, value]) => [`value.${key}`, value]),
          ),
        },
        { session },
      );
      if (update.matchedCount !== 1) {
        outcome = { kind: "CLOSED" };
        return;
      }

      outcome = {
        kind: "EXITED",
        auction: { ...auction, ...updates },
        closed: closes,
        winningBid,
      };
    });
    return outcome;
  } finally {
    await session.endSession();
  }
}

export async function saveUserActivity(userId: string, timestamp: number): Promise<void> {
  const key = `${userId}:${timestamp}`;
  await getDatabase().collection<StoredUserActivity>("userActivity").updateOne(
    { _id: key },
    { $setOnInsert: { _id: key, userId, timestamp } },
    { upsert: true },
  );
}

export async function saveWatchlist(userId: string, auctionIds: Iterable<string>): Promise<void> {
  const auctionIdsArray = [...new Set(auctionIds)];
  await getDatabase().collection<StoredWatchlist>("watchlists").updateOne(
    { _id: userId },
    { $set: { userId, auctionIds: auctionIdsArray } },
    { upsert: true },
  );
}

export async function deleteWatchlist(userId: string): Promise<void> {
  await getDatabase().collection<StoredWatchlist>("watchlists").deleteOne({ _id: userId });
}

export async function saveRequestSample(sample: RequestSample): Promise<void> {
  const key = sample.id ?? `${sample.timestamp}:${sample.method}:${sample.endpoint}:${sample.statusCode}`;
  await getDatabase().collection<Stored<RequestSample>>("requestSamples").replaceOne(
    { _id: key },
    { _id: key, value: sample },
    { upsert: true },
  );
}

export async function markNotificationRead(userId: string, notificationId: string): Promise<void> {
  await records<NotificationRecord>("notifications").updateOne(
    { _id: notificationId, "value.userId": userId },
    { $set: { "value.read": true } },
  );
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  await records<NotificationRecord>("notifications").updateMany(
    { "value.userId": userId, "value.read": false },
    { $set: { "value.read": true } },
  );
}
