import { randomUUID } from "node:crypto";

export type UserRole = "BUYER" | "SELLER" | "ADMIN";
export type AuctionStatus =
  | "UPCOMING"
  | "LIVE"
  | "ENDING_SOON"
  | "COMPLETED"
  | "CANCELLED";
export type TransactionStatus =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  passwordHash: string;
  createdAt: string;
  lastActiveAt: string | null;
}

export interface AuctionRecord {
  id: string;
  title: string;
  description: string;
  category: string;
  imageUrl: string;
  sellerId: string;
  sellerName: string;
  startingPrice: number;
  currentPrice: number;
  increment: number;
  bidCount: number;
  uniqueBidders: number;
  startAt: string;
  endAt: string;
  status: AuctionStatus;
  winnerId: string | null;
  createdAt: string;
}

export interface BidRecord {
  id: string;
  auctionId: string;
  bidderId: string;
  bidderName: string;
  amount: number;
  status: "ACCEPTED" | "REJECTED";
  placedAt: string;
  sequence: number;
  processingMs: number;
  rejectionReason: string | null;
  timing: {
    requestReceivedAt: number;
    validationStartedAt: number;
    validationCompletedAt: number;
    operationStart: number;
    operationEnd: number;
    responseSentAt: number;
  };
}

export interface NotificationRecord {
  id: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  auctionId: string | null;
  read: boolean;
  createdAt: string;
}

export interface TransactionRecord {
  id: string;
  auctionId: string;
  auctionTitle: string;
  buyerId: string;
  buyerName: string;
  sellerId: string;
  sellerName: string;
  finalPrice: number;
  status: TransactionStatus;
  paymentStatus: "NOT_STARTED" | "PENDING" | "PAID" | "FAILED";
  createdAt: string;
}

export interface ActivityRecord {
  id: string;
  userId: string | null;
  title: string;
  detail: string;
  kind: string;
  createdAt: string;
}

export interface RequestSample {
  method: string;
  endpoint: string;
  statusCode: number;
  durationMs: number;
  timestamp: number;
}

export const users: UserRecord[] = [];
export const auctions: AuctionRecord[] = [];
export const bids: BidRecord[] = [];
export const notifications: NotificationRecord[] = [];
export const transactions: TransactionRecord[] = [];
export const activities: ActivityRecord[] = [];
export const userActivity: Array<{ userId: string; timestamp: number }> = [];
export const requestSamples: RequestSample[] = [];
export const watchlists = new Map<string, Set<string>>();

export const createId = (): string => randomUUID();

export function addActivity(
  title: string,
  detail: string,
  kind: string,
  userId: string | null = null,
): ActivityRecord {
  const activity = {
    id: createId(),
    userId,
    title,
    detail,
    kind,
    createdAt: new Date().toISOString(),
  };
  activities.unshift(activity);
  activities.splice(100);
  if (userId) userActivity.push({ userId, timestamp: Date.now() });
  return activity;
}

export function addNotification(
  userId: string,
  type: string,
  title: string,
  message: string,
  auctionId: string | null = null,
): NotificationRecord {
  const notification = {
    id: createId(),
    userId,
    type,
    title,
    message,
    auctionId,
    read: false,
    createdAt: new Date().toISOString(),
  };
  notifications.unshift(notification);
  return notification;
}

export function recordRequest(sample: RequestSample): void {
  requestSamples.push(sample);
  if (requestSamples.length > 5000) requestSamples.splice(0, 1000);
}

const daysAgo = (days: number): string =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

export function seedDemoAuctions(): void {
  if (auctions.length > 0) return;

  const seller = users.find((user) => user.id === "demo-seller");
  const sellerName = seller?.name ?? "Mara Bennett";
  const records: AuctionRecord[] = [
    {
      id: "camera-01",
      title: "1968 Rangefinder Film Camera",
      description:
        "A beautifully preserved rangefinder with a bright, clean lens and precise mechanical shutter. Recently serviced and ready for its next owner.",
      category: "Collectibles",
      imageUrl: "/images/auction-camera.jpg",
      sellerId: "demo-seller",
      sellerName,
      startingPrice: 420,
      currentPrice: 590,
      increment: 25,
      bidCount: 4,
      uniqueBidders: 3,
      startAt: daysAgo(1),
      endAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
      status: "LIVE",
      winnerId: null,
      createdAt: daysAgo(3),
    },
    {
      id: "watch-01",
      title: "Gold Dress Watch, 1970s",
      description:
        "A slim vintage dress watch with a warm gold case, original cream dial, and a fresh leather strap. A timeless piece in excellent running condition.",
      category: "Watches",
      imageUrl: "/images/auction-watch.jpg",
      sellerId: "demo-seller",
      sellerName,
      startingPrice: 310,
      currentPrice: 390,
      increment: 20,
      bidCount: 3,
      uniqueBidders: 2,
      startAt: daysAgo(2),
      endAt: new Date(Date.now() + 52 * 60 * 1000).toISOString(),
      status: "ENDING_SOON",
      winnerId: null,
      createdAt: daysAgo(4),
    },
    {
      id: "vase-01",
      title: "Studio Ceramic Vase, No. 14",
      description:
        "Hand-thrown stoneware with a softly sculpted profile and a one-of-a-kind cobalt brush detail. Signed by the artist; no chips or repairs.",
      category: "Art",
      imageUrl: "/images/auction-vase.jpg",
      sellerId: "demo-seller",
      sellerName,
      startingPrice: 85,
      currentPrice: 125,
      increment: 10,
      bidCount: 2,
      uniqueBidders: 2,
      startAt: new Date(Date.now() + 18 * 60 * 60 * 1000).toISOString(),
      endAt: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString(),
      status: "UPCOMING",
      winnerId: null,
      createdAt: daysAgo(1),
    },
    {
      id: "chair-01",
      title: "Mid-Century Teak Lounge Chair",
      description:
        "An original teak frame with carefully restored joinery and newly upholstered olive wool. Comfortable, authentic, and ready to become a room's centerpiece.",
      category: "Design",
      imageUrl: "/images/auction-chair.jpg",
      sellerId: "demo-seller",
      sellerName,
      startingPrice: 680,
      currentPrice: 810,
      increment: 30,
      bidCount: 3,
      uniqueBidders: 3,
      startAt: daysAgo(12),
      endAt: daysAgo(8),
      status: "COMPLETED",
      winnerId: "demo-buyer",
      createdAt: daysAgo(14),
    },
  ];

  auctions.push(...records);

  const bidderOne = users.find((user) => user.id === "demo-buyer");
  const bidderTwo = users.find((user) => user.id === "demo-buyer-two");
  const bidderThree = users.find((user) => user.id === "demo-admin");
  const bidSeeds = [
    ["camera-01", bidderOne, 465, 1, 38],
    ["camera-01", bidderTwo, 515, 2, 34],
    ["camera-01", bidderThree, 565, 3, 31],
    ["camera-01", bidderOne, 590, 4, 29],
    ["watch-01", bidderTwo, 350, 1, 45],
    ["watch-01", bidderOne, 370, 2, 32],
    ["watch-01", bidderTwo, 390, 3, 27],
    ["vase-01", bidderOne, 105, 1, 24],
    ["vase-01", bidderTwo, 125, 2, 20],
    ["chair-01", bidderOne, 740, 1, 41],
    ["chair-01", bidderTwo, 770, 2, 36],
    ["chair-01", bidderOne, 810, 3, 30],
  ] as const;

  for (const [auctionId, bidder, amount, sequence, processingMs] of bidSeeds) {
    if (!bidder) continue;
    const timestamp = Date.now() - (sequence + auctionId.length) * 60 * 60 * 1000;
    bids.push({
      id: createId(),
      auctionId,
      bidderId: bidder.id,
      bidderName: bidder.name,
      amount,
      status: "ACCEPTED",
      placedAt: new Date(timestamp).toISOString(),
      sequence,
      processingMs,
      rejectionReason: null,
      timing: {
        requestReceivedAt: timestamp,
        validationStartedAt: timestamp + 1,
        validationCompletedAt: timestamp + 2,
        operationStart: timestamp + 2,
        operationEnd: timestamp + 2 + processingMs,
        responseSentAt: timestamp + processingMs + 3,
      },
    });
    userActivity.push({ userId: bidder.id, timestamp });
  }

  transactions.push({
    id: createId(),
    auctionId: "chair-01",
    auctionTitle: "Mid-Century Teak Lounge Chair",
    buyerId: "demo-buyer",
    buyerName: bidderOne?.name ?? "Alex Morgan",
    sellerId: "demo-seller",
    sellerName,
    finalPrice: 810,
    status: "PENDING",
    paymentStatus: "NOT_STARTED",
    createdAt: daysAgo(8),
  });

  addActivity("Auction completed", "Mid-Century Teak Lounge Chair closed at $810", "auction");
  addActivity("New listing", "1968 Rangefinder Film Camera is live", "auction");
}

