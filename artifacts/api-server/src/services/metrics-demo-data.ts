import {
  activities,
  auctions,
  bids,
  requestSamples,
  transactions,
  userActivity,
  users,
  type ActivityRecord,
  type AuctionRecord,
  type BidRecord,
  type RequestSample,
  type TransactionRecord,
  type UserRecord,
} from "../repositories/memory-store";

export const METRICS_DEMO_ID_PREFIX = "metrics-demo-";

const DAY_MS = 24 * 60 * 60 * 1000;

interface DemoAuctionConfig {
  id: string;
  endOffsetMs: number;
  durationMs: number;
  startingPrice: number;
  increment: number;
  sellerId: string;
  winnerId: string;
  transactionStatus: TransactionRecord["status"];
  bids: Array<{
    bidderId: string;
    amount: number;
    status: BidRecord["status"];
    currentPrice: number;
    rulesFailed: string[];
  }>;
}

function iso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function demoId(value: string): string {
  return `${METRICS_DEMO_ID_PREFIX}${value}`;
}

export function seedMetricsDemoData(now = Date.now()): number {
  if (auctions.some((auction) => auction.id.startsWith(METRICS_DEMO_ID_PREFIX))) {
    return 0;
  }

  const demoAccounts: Array<[string, string, UserRecord["role"]]> = [
    ["buyer-1", "Buyer One", "BUYER"],
    ["buyer-2", "Buyer Two", "BUYER"],
    ["buyer-3", "Buyer Three", "BUYER"],
    ["seller-1", "Seller One", "SELLER"],
    ["admin", "Demo Administrator", "ADMIN"],
  ];
  const demoUsers: UserRecord[] = demoAccounts.map(([id, name, role]) => ({
    id: demoId(`user-${id}`),
    name,
    email: `${id}@metrics-demo.invalid`,
    role: role as UserRecord["role"],
    passwordHash: "",
    createdAt: iso(now - 30 * DAY_MS),
    lastActiveAt: null,
  }));
  users.push(...demoUsers);

  const configurations: DemoAuctionConfig[] = [
    {
      id: "recent-1",
      endOffsetMs: 2 * 60 * 60 * 1000,
      durationMs: 2 * 60 * 60 * 1000,
      startingPrice: 10,
      increment: 1,
      sellerId: "seller-1",
      winnerId: "buyer-2",
      transactionStatus: "COMPLETED",
      bids: [
        { bidderId: "buyer-1", amount: 11, status: "ACCEPTED", currentPrice: 10, rulesFailed: [] },
        { bidderId: "buyer-2", amount: 13, status: "ACCEPTED", currentPrice: 12, rulesFailed: [] },
        { bidderId: "buyer-3", amount: 13, status: "REJECTED", currentPrice: 13, rulesFailed: ["below-minimum"] },
      ],
    },
    {
      id: "recent-2",
      endOffsetMs: 60 * 60 * 1000,
      durationMs: 90 * 60 * 1000,
      startingPrice: 25,
      increment: 2,
      sellerId: "seller-1",
      winnerId: "buyer-1",
      transactionStatus: "COMPLETED",
      bids: [
        { bidderId: "buyer-2", amount: 27, status: "ACCEPTED", currentPrice: 25, rulesFailed: [] },
        { bidderId: "buyer-1", amount: 31, status: "ACCEPTED", currentPrice: 29, rulesFailed: [] },
        { bidderId: "buyer-3", amount: 32, status: "REJECTED", currentPrice: 31, rulesFailed: ["below-minimum"] },
      ],
    },
    {
      id: "older-1",
      endOffsetMs: 9 * DAY_MS,
      durationMs: 3 * 60 * 60 * 1000,
      startingPrice: 50,
      increment: 5,
      sellerId: "seller-1",
      winnerId: "buyer-3",
      transactionStatus: "COMPLETED",
      bids: [
        { bidderId: "buyer-1", amount: 55, status: "ACCEPTED", currentPrice: 50, rulesFailed: [] },
        { bidderId: "buyer-3", amount: 65, status: "ACCEPTED", currentPrice: 60, rulesFailed: [] },
        { bidderId: "buyer-2", amount: 65, status: "REJECTED", currentPrice: 65, rulesFailed: ["below-minimum"] },
      ],
    },
    {
      id: "older-2",
      endOffsetMs: 8 * DAY_MS,
      durationMs: 2 * 60 * 60 * 1000,
      startingPrice: 100,
      increment: 10,
      sellerId: "seller-1",
      winnerId: "buyer-1",
      transactionStatus: "PENDING",
      bids: [
        { bidderId: "buyer-2", amount: 110, status: "ACCEPTED", currentPrice: 100, rulesFailed: [] },
        { bidderId: "buyer-1", amount: 120, status: "ACCEPTED", currentPrice: 110, rulesFailed: [] },
      ],
    },
  ];

  const auctionRecords: AuctionRecord[] = [];
  const bidRecords: BidRecord[] = [];
  const transactionRecords: TransactionRecord[] = [];
  const requestRecords: RequestSample[] = [];
  const activityRecords: Array<{ userId: string; timestamp: number }> = [];
  const activityLog: ActivityRecord[] = [];

  for (const [auctionIndex, config] of configurations.entries()) {
    const end = now - config.endOffsetMs;
    const start = end - config.durationMs;
    const auctionId = demoId(`auction-${config.id}`);
    const sellerId = demoId(`user-${config.sellerId}`);
    const winnerId = demoId(`user-${config.winnerId}`);
    const seller = demoUsers.find((user) => user.id === sellerId)!;
    const auction: AuctionRecord = {
      id: auctionId,
      title: `DEMO — Metrics sample lot ${auctionIndex + 1}`,
      description: "Synthetic record created only for local metrics demonstration.",
      category: "Demo",
      imageUrl: "",
      sellerId,
      sellerName: seller.name,
      startingPrice: config.startingPrice,
      currentPrice: config.bids
        .filter((bid) => bid.status === "ACCEPTED")
        .reduce((maximum, bid) => Math.max(maximum, bid.amount), config.startingPrice),
      increment: config.increment,
      bidCount: config.bids.filter((bid) => bid.status === "ACCEPTED").length,
      uniqueBidders: new Set(config.bids.filter((bid) => bid.status === "ACCEPTED").map((bid) => bid.bidderId)).size,
      startAt: iso(start),
      endAt: iso(end),
      finalizedAt: iso(end + 5 * 60 * 1000),
      status: "COMPLETED",
      winnerId,
      createdAt: iso(start - 10 * 60 * 1000),
    };
    auctionRecords.push(auction);

    let price = config.startingPrice;
    config.bids.forEach((bid, index) => {
      const placedAt = start + (index + 1) * Math.floor(config.durationMs / (config.bids.length + 1));
      const userId = demoId(`user-${bid.bidderId}`);
      const bidder = demoUsers.find((user) => user.id === userId)!;
      const bidId = demoId(`bid-${config.id}-${index + 1}`);
      const processingMs = 14 + (auctionIndex + index) * 7;
      const accepted = bid.status === "ACCEPTED";
      const sequence = index + 1;
      bidRecords.push({
        id: bidId,
        auctionId,
        bidderId: userId,
        bidderName: bidder.name,
        amount: bid.amount,
        status: bid.status,
        placedAt: iso(placedAt),
        sequence,
        processingMs,
        rejectionReason: accepted ? null : "Demo rejected: bid is below the minimum increment.",
        validationAudit: {
          evaluated: true,
          accepted,
          rulesFailed: bid.rulesFailed,
          auctionStatus: "LIVE",
          currentPrice: bid.currentPrice,
          increment: config.increment,
          sellerId,
        },
        timing: {
          requestReceivedAt: placedAt,
          validationStartedAt: placedAt,
          validationCompletedAt: placedAt + processingMs,
          operationStart: placedAt + processingMs,
          operationEnd: placedAt + processingMs,
          responseSentAt: placedAt + processingMs,
        },
      });
      if (accepted) price = bid.amount;

      requestRecords.push({
        id: demoId(`request-${config.id}-${index + 1}`),
        method: "POST",
        endpoint: `/api/auctions/${auctionId}/bids`,
        statusCode: accepted ? 201 : 400,
        durationMs: processingMs + 4,
        timestamp: placedAt,
        userId,
      });
      activityRecords.push({ userId, timestamp: placedAt });
    });

    auction.currentPrice = price;
    const transactionCreatedAt = end + 10 * 60 * 1000;
    transactionRecords.push({
      id: demoId(`transaction-${config.id}`),
      auctionId,
      auctionTitle: auction.title,
      buyerId: winnerId,
      buyerName: demoUsers.find((user) => user.id === winnerId)!.name,
      sellerId,
      sellerName: seller.name,
      finalPrice: auction.currentPrice,
      status: config.transactionStatus,
      paymentStatus: config.transactionStatus === "COMPLETED" ? "PAID" : "PENDING",
      createdAt: iso(transactionCreatedAt),
      transactionDeadlineAt: iso(transactionCreatedAt + 7 * DAY_MS),
    });
  }

  for (const [index, durationMs] of [9, 18, 31, 46, 22, 38].entries()) {
    requestRecords.push({
      id: demoId(`request-api-${index + 1}`),
      method: index % 2 === 0 ? "GET" : "POST",
      endpoint: index % 2 === 0 ? "/api/healthz" : "/api/account/watchlist",
      statusCode: index % 2 === 0 ? 200 : 201,
      durationMs,
      timestamp: now - (index + 1) * 20 * 60 * 1000,
      userId: index % 2 === 0 ? undefined : demoId("user-buyer-1"),
    });
  }

  for (const user of demoUsers) {
    activityRecords.push({
      userId: user.id,
      timestamp: now - (user.role === "ADMIN" ? 45 : 30) * 60 * 1000,
    });
  }

  for (const [index, activity] of activityRecords.entries()) {
    userActivity.push(activity);
    activityLog.push({
      id: demoId(`activity-${index + 1}`),
      userId: activity.userId,
      title: "Demo account activity",
      detail: "Synthetic activity created for local metrics demonstration.",
      kind: "metrics-demo",
      createdAt: iso(activity.timestamp),
    });
  }

  auctions.push(...auctionRecords);
  bids.push(...bidRecords);
  transactions.push(...transactionRecords);
  requestSamples.push(...requestRecords);
  activities.push(...activityLog);
  return auctionRecords.length;
}
