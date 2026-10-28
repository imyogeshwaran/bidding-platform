import { randomUUID } from "node:crypto";

export type UserRole = "BUYER" | "SELLER" | "ADMIN";

export function normalizeUserRole(role: unknown): UserRole | null {
  if (typeof role !== "string") return null;

  switch (role.trim().toUpperCase()) {
    case "BUYER":
      return "BUYER";
    case "SELLER":
      return "SELLER";
    case "ADMIN":
      return "ADMIN";
    default:
      return null;
  }
}

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
  isSuspended?: boolean;
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
  exitedBidderIds?: string[];
  finalizedAt?: string;
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
  validationAudit?: {
    evaluated: true;
    accepted: boolean;
    rulesFailed: string[];
    auctionStatus: AuctionStatus;
    currentPrice: number;
    increment: number;
    sellerId: string;
  };
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
  transactionDeadlineAt?: string;
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
  id?: string;
  method: string;
  endpoint: string;
  statusCode: number;
  durationMs: number;
  timestamp: number;
  userId?: string;
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
}
