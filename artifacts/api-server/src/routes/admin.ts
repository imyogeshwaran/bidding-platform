import { Router, type IRouter, type Response } from "express";
import {
  GetAuctionFairnessResponse,
  GetBiddingEngagementResponse,
  GetMetricsOverviewResponse,
  GetPerformanceMetricsResponse,
  GetUsersResponse,
} from "@workspace/api-zod";
import { allowRoles, authenticate, getAuthenticatedUser } from "../middlewares/auth";
import {
  addActivity,
  auctions,
  bids,
  requestSamples,
  userActivity,
  users,
  type UserRecord,
} from "../repositories/memory-store";
import { refreshAuctionStatus } from "./auctions";
import {
  getSoftwareMetrics,
  parseMetricsRange,
} from "../services/software-metrics";

const router: IRouter = Router();
const DAY_MS = 24 * 60 * 60 * 1000;

function publicUser(user: UserRecord) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isSuspended: user.isSuspended === true,
    createdAt: user.createdAt,
    lastActiveAt: user.lastActiveAt,
  };
}

function dayBuckets(): Array<{ key: string; label: string }> {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(Date.now() - (6 - index) * DAY_MS);
    date.setUTCHours(0, 0, 0, 0);
    return {
      key: date.toISOString().slice(0, 10),
      label: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    };
  });
}

function historyFor(timestamps: number[]): Array<{ label: string; value: number }> {
  return dayBuckets().map((day) => ({
    label: day.label,
    value: timestamps.filter((timestamp) => new Date(timestamp).toISOString().slice(0, 10) === day.key).length,
  }));
}

function trendPercent(history: Array<{ label: string; value: number }>): number {
  const current = history[history.length - 1]?.value ?? 0;
  const previous = history[history.length - 2]?.value ?? 0;
  return previous === 0 ? (current === 0 ? 0 : 100) : Number((((current - previous) / previous) * 100).toFixed(1));
}

function score(factors: Array<{ key: string; label: string; value: number; weight: number }>): number {
  return Math.round(factors.reduce((total, factor) => total + factor.value * factor.weight / 100, 0));
}

function adminOnly() {
  return [authenticate, allowRoles("ADMIN")];
}

function softwareMetrics(
  rangeValue: unknown,
  response: Response,
  section: "overview" | "standard" | "custom" | "trends",
): void {
  const range = parseMetricsRange(rangeValue);
  if (!range) {
    response.status(400).json({
      success: false,
      error: {
        code: "INVALID_METRICS_RANGE",
        message: "Use range=1h, 24h, 7d, 30d, or all.",
      },
    });
    return;
  }
  const snapshot = getSoftwareMetrics(range);
  const demoDataEnabled =
    process.env["NODE_ENV"] === "development" &&
    process.env["METRICS_DEMO_MODE"] === "true";
  response.json({
    success: true,
    data: section === "overview"
      ? {
          ...snapshot.overview,
          range: snapshot.range,
          period: snapshot.period,
          updatedAt: snapshot.updatedAt,
          demoData: demoDataEnabled,
        }
      : section === "standard"
        ? { metrics: snapshot.standard, range: snapshot.range, period: snapshot.period, updatedAt: snapshot.updatedAt }
        : section === "custom"
          ? { metrics: snapshot.custom, range: snapshot.range, period: snapshot.period, updatedAt: snapshot.updatedAt }
          : { trends: snapshot.trends, range: snapshot.range, period: snapshot.period, updatedAt: snapshot.updatedAt },
    message: "Software metrics loaded.",
  });
}

router.get("/admin/metrics/overview", ...adminOnly(), (request, response): void => {
  softwareMetrics(request.query.range, response, "overview");
});
router.get("/admin/metrics/standard", ...adminOnly(), (request, response): void => {
  softwareMetrics(request.query.range, response, "standard");
});
router.get("/admin/metrics/custom", ...adminOnly(), (request, response): void => {
  softwareMetrics(request.query.range, response, "custom");
});
router.get("/admin/metrics/trends", ...adminOnly(), (request, response): void => {
  softwareMetrics(request.query.range, response, "trends");
});

router.get("/users", ...adminOnly(), (_request, response): void => {
  response.json(GetUsersResponse.parse({
    success: true,
    data: users.map(publicUser),
    message: "Platform users loaded.",
  }));
});

router.patch("/users/suspension", ...adminOnly(), (request, response): void => {
  const user = getAuthenticatedUser(response);
  const accountId = request.query.id;
  const suspendedValue = request.query.suspended;
  if (
    typeof accountId !== "string" ||
    (suspendedValue !== "true" && suspendedValue !== "false")
  ) {
    response.status(400).json({ success: false, error: { code: "INVALID_SUSPENSION_STATE", message: "Choose whether to suspend or restore this account." } });
    return;
  }
  const suspended = suspendedValue === "true";
  const target = users.find((candidate) => candidate.id === accountId);
  if (!target) {
    response.status(404).json({ success: false, error: { code: "USER_NOT_FOUND", message: "That account could not be found." } });
    return;
  }
  if (target.id === user?.id || target.role === "ADMIN") {
    response.status(403).json({ success: false, error: { code: "USER_PROTECTED", message: "Administrator accounts cannot be suspended." } });
    return;
  }

  target.isSuspended = suspended;
  addActivity(
    suspended ? "Account suspended" : "Account restored",
    `${target.name}'s account was ${suspended ? "suspended" : "restored"} by an administrator.`,
    "admin",
    user?.id ?? null,
  );
  response.json({
    success: true,
    data: publicUser(target),
    message: suspended ? "Account suspended." : "Account restored.",
  });
});

router.get("/metrics/overview", ...adminOnly(), (_request, response): void => {
  const bidTimes = bids.map((bid) => Date.parse(bid.placedAt)).filter(Number.isFinite);
  const auctionTimes = auctions.map((auction) => Date.parse(auction.createdAt)).filter(Number.isFinite);
  const activeSince = Date.now() - 30 * DAY_MS;
  const activeUserCount = new Set(userActivity.filter((item) => item.timestamp >= activeSince).map((item) => item.userId)).size;
  const metrics = [
    {
      id: "users",
      label: "Registered users",
      value: users.length,
      unit: "",
      formula: "Total registered accounts",
      period: "All time",
      trendPercent: 0,
      history: historyFor(users.map((user) => Date.parse(user.createdAt)).filter(Number.isFinite)),
    },
    {
      id: "active-users",
      label: "Active users",
      value: activeUserCount,
      unit: "",
      formula: "Accounts with activity in the last 30 days",
      period: "Last 30 days",
      trendPercent: 0,
      history: historyFor(userActivity.map((item) => item.timestamp)),
    },
    {
      id: "auctions",
      label: "Auctions",
      value: auctions.length,
      unit: "",
      formula: "Total auction listings",
      period: "All time",
      trendPercent: trendPercent(historyFor(auctionTimes)),
      history: historyFor(auctionTimes),
    },
    {
      id: "accepted-bids",
      label: "Accepted bids",
      value: bids.filter((bid) => bid.status === "ACCEPTED").length,
      unit: "",
      formula: "Bids accepted by auction validation",
      period: "All time",
      trendPercent: trendPercent(historyFor(bidTimes)),
      history: historyFor(bidTimes),
    },
  ];

  response.json(GetMetricsOverviewResponse.parse({
    success: true,
    data: {
      metrics,
      bidActivity: historyFor(bidTimes),
      auctionActivity: historyFor(auctionTimes),
      bidOutcomes: [
        { label: "Accepted", value: bids.filter((bid) => bid.status === "ACCEPTED").length },
        { label: "Rejected", value: bids.filter((bid) => bid.status === "REJECTED").length },
      ],
      generatedAt: new Date().toISOString(),
    },
    message: "Platform metrics loaded.",
  }));
});

router.get("/metrics/performance", ...adminOnly(), (_request, response): void => {
  const now = Date.now();
  const hour = requestSamples.filter((sample) => now - sample.timestamp <= 60 * 60 * 1000);
  const sortedDurations = hour.map((sample) => sample.durationMs).sort((a, b) => a - b);
  const percentile = (p: number): number => sortedDurations.length
    ? Number(sortedDurations[Math.min(sortedDurations.length - 1, Math.ceil(sortedDurations.length * p) - 1)].toFixed(2))
    : 0;
  const minute = hour.filter((sample) => now - sample.timestamp <= 60_000);
  const binSize = 5 * 60 * 1000;
  const responseHistory = Array.from({ length: 12 }, (_, index) => {
    const end = now - (11 - index) * binSize;
    const start = end - binSize;
    return {
      label: new Date(end).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
      value: hour.filter((sample) => sample.timestamp > start && sample.timestamp <= end).length,
    };
  });
  const failedRequests = hour.filter((sample) => sample.statusCode >= 400).length;
  const processingTimes = bids.map((bid) => bid.processingMs).filter(Number.isFinite);

  response.json(GetPerformanceMetricsResponse.parse({
    success: true,
    data: {
      requestCount: hour.length,
      successfulRequests: hour.length - failedRequests,
      failedRequests,
      averageResponseMs: sortedDurations.length
        ? Number((sortedDurations.reduce((sum, duration) => sum + duration, 0) / sortedDurations.length).toFixed(2))
        : 0,
      p95ResponseMs: percentile(0.95),
      p99ResponseMs: percentile(0.99),
      throughputPerMinute: minute.length,
      errorRatePercent: hour.length ? Number((failedRequests / hour.length * 100).toFixed(2)) : 0,
      bidAverageProcessingMs: processingTimes.length
        ? Number((processingTimes.reduce((sum, duration) => sum + duration, 0) / processingTimes.length).toFixed(2))
        : 0,
      responseHistory,
    },
    message: "Request performance metrics loaded.",
  }));
});

router.get("/metrics/bidding-engagement", ...adminOnly(), (_request, response): void => {
  const activeAuctions = auctions.filter((auction) => {
    const status = refreshAuctionStatus(auction);
    return status === "LIVE" || status === "ENDING_SOON";
  });
  const activeWithBids = activeAuctions.filter((auction) =>
    bids.some((bid) => bid.auctionId === auction.id && bid.status === "ACCEPTED"),
  ).length;
  const acceptedBids = bids.filter((bid) => bid.status === "ACCEPTED");
  const distinctBidders = new Set(acceptedBids.map((bid) => bid.bidderId)).size;
  const factors = [
    { key: "active-auction-participation", label: "Live auctions with bids", value: activeAuctions.length ? Math.round(activeWithBids / activeAuctions.length * 100) : 0, weight: 40 },
    { key: "bidder-diversity", label: "Bidder participation", value: acceptedBids.length ? Math.min(100, Math.round(distinctBidders / acceptedBids.length * 100)) : 0, weight: 35 },
    { key: "bid-activity", label: "Bid activity", value: Math.min(100, acceptedBids.length * 5), weight: 25 },
  ];
  const comparisons = auctions.slice(0, 10).map((auction) => {
    const auctionBids = acceptedBids.filter((bid) => bid.auctionId === auction.id);
    return {
      auctionId: auction.id,
      auctionTitle: auction.title,
      score: Math.min(100, auctionBids.length * 10 + new Set(auctionBids.map((bid) => bid.bidderId)).size * 10),
    };
  });
  response.json(GetBiddingEngagementResponse.parse({
    success: true,
    data: {
      score: score(factors),
      formula: "Weighted score from live-auction participation, bidder diversity, and accepted-bid activity.",
      factors,
      trend: historyFor(bids.filter((bid) => bid.status === "ACCEPTED").map((bid) => Date.parse(bid.placedAt))),
      comparisons,
    },
    message: "Bidding engagement metrics loaded.",
  }));
});

router.get("/metrics/auction-fairness", ...adminOnly(), (_request, response): void => {
  const acceptedBids = bids.filter((bid) => bid.status === "ACCEPTED");
  const timestampedBids = bids.filter((bid) =>
    Number.isFinite(Date.parse(bid.placedAt)) &&
    Number.isFinite(bid.timing?.requestReceivedAt) &&
    Number.isFinite(bid.sequence),
  ).length;
  const auctionsWithHistory = auctions.filter((auction) =>
    bids.some((bid) => bid.auctionId === auction.id),
  ).length;
  const factors = [
    { key: "timestamp-coverage", label: "Bids with timestamped records", value: bids.length ? Math.round(timestampedBids / bids.length * 100) : 0, weight: 40 },
    { key: "bid-history-coverage", label: "Auctions with bid history", value: auctions.length ? Math.round(auctionsWithHistory / auctions.length * 100) : 0, weight: 35 },
    { key: "validation-records", label: "Recorded bid outcomes", value: bids.length ? Math.round((acceptedBids.length + bids.filter((bid) => bid.status === "REJECTED").length) / bids.length * 100) : 0, weight: 25 },
  ];
  const comparisons = auctions.slice(0, 10).map((auction) => {
    const auctionBids = bids.filter((bid) => bid.auctionId === auction.id);
    const audited = auctionBids.filter((bid) =>
      Number.isFinite(Date.parse(bid.placedAt)) && Number.isFinite(bid.sequence),
    ).length;
    return {
      auctionId: auction.id,
      auctionTitle: auction.title,
      score: auctionBids.length ? Math.round(audited / auctionBids.length * 100) : 0,
    };
  });
  response.json(GetAuctionFairnessResponse.parse({
    success: true,
    data: {
      score: score(factors),
      formula: "Weighted score from timestamp coverage, visible bid history, and recorded bid outcomes.",
      factors,
      trend: historyFor(bids.map((bid) => Date.parse(bid.placedAt)).filter(Number.isFinite)),
      comparisons,
    },
    message: "Auction fairness metrics loaded.",
  }));
});

export default router;
