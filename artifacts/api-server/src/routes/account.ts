import { Router, type IRouter, type Response } from "express";
import {
  AddToWatchlistParams,
  AddToWatchlistResponse,
  GetDashboardSummaryResponse,
  GetNotificationsResponse,
  GetTransactionsResponse,
  GetWatchlistResponse,
  MarkAllNotificationsReadResponse,
  MarkNotificationReadParams,
  MarkNotificationReadResponse,
  RemoveFromWatchlistParams,
} from "@workspace/api-zod";
import { authenticate, getAuthenticatedUser } from "../middlewares/auth";
import {
  activities,
  auctions,
  bids,
  notifications,
  transactions,
  userActivity,
  users,
  watchlists,
} from "../repositories/memory-store";
import { refreshAuctionStatus } from "./auctions";

const router: IRouter = Router();

function sendError(response: Response, status: number, code: string, message: string): void {
  response.status(status).json({ success: false, error: { code, message } });
}

router.get("/dashboard/summary", authenticate, (_request, response): void => {
  const user = getAuthenticatedUser(response);
  if (!user) {
    sendError(response, 401, "AUTH_REQUIRED", "Sign in to view your dashboard.");
    return;
  }

  const acceptedBids = bids.filter((bid) => bid.status === "ACCEPTED");
  const currentUserBids = acceptedBids.filter((bid) => bid.bidderId === user.id);
  const completedAuctions = auctions.filter((auction) => refreshAuctionStatus(auction) === "COMPLETED");
  const watchedCount = watchlists.get(user.id)?.size ?? 0;
  const userTransactions = transactions.filter(
    (transaction) =>
      user.role === "ADMIN" ||
      transaction.buyerId === user.id ||
      transaction.sellerId === user.id,
  );
  const activeUserIds = new Set(
    userActivity
      .filter((item) => Date.now() - item.timestamp <= 30 * 24 * 60 * 60 * 1000)
      .map((item) => item.userId)
      .filter((userId) => users.some((candidate) => candidate.id === userId)),
  );
  const visibleActivity = activities
    .filter((item) => user.role === "ADMIN" || item.userId === null || item.userId === user.id)
    .slice(0, 8)
    .map(({ id, title, detail, createdAt, kind }) => ({ id, title, detail, createdAt, kind }));
  const wonCount = completedAuctions.filter((auction) => auction.winnerId === user.id).length;
  const lostCount = completedAuctions.filter(
    (auction) =>
      auction.winnerId !== user.id &&
      acceptedBids.some((bid) => bid.auctionId === auction.id && bid.bidderId === user.id),
  ).length;
  const sellerAuctions = auctions.filter((auction) => auction.sellerId === user.id);
  const totalAcceptedBids = acceptedBids.length;

  response.json(
    GetDashboardSummaryResponse.parse({
      success: true,
      data: {
        totalAuctions: auctions.length,
        liveAuctions: auctions.filter((auction) => {
          const status = refreshAuctionStatus(auction);
          return status === "LIVE" || status === "ENDING_SOON";
        }).length,
        completedAuctions: completedAuctions.length,
        totalBids: totalAcceptedBids,
        activeUsers: activeUserIds.size,
        transactions: userTransactions.length,
        watchlistCount: watchedCount,
        activeBidCount: currentUserBids.filter((bid) => {
          const auction = auctions.find((item) => item.id === bid.auctionId);
          if (!auction) return false;
          const status = refreshAuctionStatus(auction);
          return status === "LIVE" || status === "ENDING_SOON";
        }).length,
        wonCount,
        lostCount,
        totalSpending: userTransactions
          .filter((transaction) => transaction.buyerId === user.id && transaction.status === "COMPLETED")
          .reduce((total, transaction) => total + transaction.finalPrice, 0),
        sellerRevenue: userTransactions
          .filter((transaction) => transaction.sellerId === user.id && transaction.status === "COMPLETED")
          .reduce((total, transaction) => total + transaction.finalPrice, 0),
        averageBidsPerAuction: auctions.length ? totalAcceptedBids / auctions.length : 0,
        recentActivity: visibleActivity,
      },
      message: "Dashboard summary loaded.",
    }),
  );
});

router.get("/notifications", authenticate, (_request, response): void => {
  const user = getAuthenticatedUser(response);
  if (!user) {
    sendError(response, 401, "AUTH_REQUIRED", "Sign in to view notifications.");
    return;
  }
  const items = notifications
    .filter((notification) => notification.userId === user.id)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .map(({ userId: _userId, ...notification }) => notification);
  response.json(
    GetNotificationsResponse.parse({
      success: true,
      data: items,
      unreadCount: items.filter((item) => !item.read).length,
      message: "Notifications loaded.",
    }),
  );
});

router.put("/notifications/:id/read", authenticate, (request, response): void => {
  const user = getAuthenticatedUser(response);
  const params = MarkNotificationReadParams.safeParse(request.params);
  if (!user) {
    sendError(response, 401, "AUTH_REQUIRED", "Sign in to manage notifications.");
    return;
  }
  if (!params.success) {
    sendError(response, 400, "INVALID_NOTIFICATION_ID", "The notification ID is invalid.");
    return;
  }
  const notification = notifications.find(
    (candidate) => candidate.id === params.data.id && candidate.userId === user.id,
  );
  if (!notification) {
    sendError(response, 404, "NOTIFICATION_NOT_FOUND", "That notification could not be found.");
    return;
  }
  notification.read = true;
  const { userId: _userId, ...publicNotification } = notification;
  response.json(
    MarkNotificationReadResponse.parse({
      success: true,
      data: publicNotification,
      message: "Notification marked as read.",
    }),
  );
});

router.put("/notifications/read-all", authenticate, (_request, response): void => {
  const user = getAuthenticatedUser(response);
  if (!user) {
    sendError(response, 401, "AUTH_REQUIRED", "Sign in to manage notifications.");
    return;
  }
  let updated = 0;
  for (const notification of notifications) {
    if (notification.userId === user.id && !notification.read) {
      notification.read = true;
      updated += 1;
    }
  }
  response.json(
    MarkAllNotificationsReadResponse.parse({
      success: true,
      data: updated,
      message: "Notifications marked as read.",
    }),
  );
});

router.get("/watchlist", authenticate, (request, response): void => {
  const user = getAuthenticatedUser(response);
  if (!user) {
    sendError(response, 401, "AUTH_REQUIRED", "Sign in to view your watchlist.");
    return;
  }
  const ids = watchlists.get(user.id) ?? new Set<string>();
  const items = auctions.filter((auction) => ids.has(auction.id));
  items.forEach(refreshAuctionStatus);
  response.json(
    GetWatchlistResponse.parse({
      success: true,
      data: items,
      total: items.length,
      page: 1,
      pageSize: Math.max(items.length, 1),
      message: "Watchlist loaded.",
    }),
  );
});

router.post("/watchlist/:auctionId", authenticate, (request, response): void => {
  const user = getAuthenticatedUser(response);
  const params = AddToWatchlistParams.safeParse(request.params);
  if (!user) {
    sendError(response, 401, "AUTH_REQUIRED", "Sign in to save auctions.");
    return;
  }
  if (!params.success) {
    sendError(response, 400, "INVALID_AUCTION_ID", "The auction ID is invalid.");
    return;
  }
  if (!auctions.some((auction) => auction.id === params.data.auctionId)) {
    sendError(response, 404, "AUCTION_NOT_FOUND", "That auction could not be found.");
    return;
  }
  const ids = watchlists.get(user.id) ?? new Set<string>();
  ids.add(params.data.auctionId);
  watchlists.set(user.id, ids);
  response.json(
    AddToWatchlistResponse.parse({
      success: true,
      data: true,
      message: "Auction added to your watchlist.",
    }),
  );
});

router.delete("/watchlist/:auctionId", authenticate, (request, response): void => {
  const user = getAuthenticatedUser(response);
  const params = RemoveFromWatchlistParams.safeParse(request.params);
  if (!user) {
    sendError(response, 401, "AUTH_REQUIRED", "Sign in to edit your watchlist.");
    return;
  }
  if (!params.success) {
    sendError(response, 400, "INVALID_AUCTION_ID", "The auction ID is invalid.");
    return;
  }
  watchlists.get(user.id)?.delete(params.data.auctionId);
  response.sendStatus(204);
});

router.get("/transactions", authenticate, (_request, response): void => {
  const user = getAuthenticatedUser(response);
  if (!user) {
    sendError(response, 401, "AUTH_REQUIRED", "Sign in to view transactions.");
    return;
  }
  const visibleTransactions = transactions
    .filter(
      (transaction) =>
        user.role === "ADMIN" ||
        transaction.buyerId === user.id ||
        transaction.sellerId === user.id,
    )
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  response.json(
    GetTransactionsResponse.parse({
      success: true,
      data: visibleTransactions,
      message: "Transactions loaded.",
    }),
  );
});

export default router;
