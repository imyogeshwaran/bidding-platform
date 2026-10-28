import {
  auctions,
  bids,
  requestSamples,
  transactions,
  userActivity,
  users,
  type BidRecord,
  type RequestSample,
} from "../repositories/memory-store";

export type MetricsRange = "1h" | "24h" | "7d" | "30d" | "all";

interface Window {
  start: number | null;
  end: number;
}

interface Metric {
  id: string;
  name: string;
  description: string;
  formula: string;
  value: number | null;
  unit: string;
  period: string;
  updatedAt: string;
  status: "AVAILABLE" | "INSUFFICIENT_DATA";
  supportingStats?: Record<string, number | string | null>;
  components?: Array<{
    key: string;
    name: string;
    value: number | null;
    weight: number;
    description: string;
  }>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const TRANSACTION_DEADLINE_MS = 7 * DAY_MS;
const rangeDurations: Record<Exclude<MetricsRange, "all">, number> = {
  "1h": 60 * 60 * 1000,
  "24h": DAY_MS,
  "7d": 7 * DAY_MS,
  "30d": 30 * DAY_MS,
};

export const METRIC_RANGES: MetricsRange[] = ["1h", "24h", "7d", "30d", "all"];

function inWindow(timestamp: number, window: Window): boolean {
  return Number.isFinite(timestamp) &&
    timestamp <= window.end &&
    (window.start === null || timestamp >= window.start);
}

function dateInWindow(value: string, window: Window): boolean {
  return inWindow(Date.parse(value), window);
}

function rounded(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function ratio(numerator: number, denominator: number, digits = 2): number | null {
  return denominator > 0 ? rounded(numerator / denominator * 100, digits) : null;
}

function avg(total: number, count: number, digits = 2): number | null {
  return count > 0 ? rounded(total / count, digits) : null;
}

function attemptSamples(window: Window): RequestSample[] {
  return requestSamples.filter(
    (sample) =>
      sample.method === "POST" &&
      /^\/api\/auctions\/[^/]+\/bids$/.test(sample.endpoint) &&
      inWindow(sample.timestamp, window),
  );
}

function isSuccessfulAttempt(sample: RequestSample): boolean {
  return sample.statusCode >= 200 && sample.statusCode < 300;
}

function periodLabel(range: MetricsRange): string {
  return range === "all" ? "All time" : `Last ${range}`;
}

function metric(
  updatedAt: string,
  range: MetricsRange,
  details: Omit<Metric, "updatedAt" | "period">,
): Metric {
  return { ...details, period: periodLabel(range), updatedAt };
}

function makeSnapshot(range: MetricsRange, now: number) {
  const period = periodLabel(range);
  const window: Window = {
    start: range === "all" ? null : now - rangeDurations[range],
    end: now,
  };
  const updatedAt = new Date(now).toISOString();
  const attempts = attemptSamples(window);
  const acceptedAttempts = attempts.filter(isSuccessfulAttempt);
  const rejectedAttempts = attempts.filter((sample) => !isSuccessfulAttempt(sample));
  const periodBids = bids.filter((bid) => dateInWindow(bid.placedAt, window));
  const acceptedBids = periodBids.filter((bid) => bid.status === "ACCEPTED");
  const rejectedBids = periodBids.filter((bid) => bid.status === "REJECTED");
  const periodAuctions = auctions.filter((auction) => dateInWindow(auction.createdAt, window));
  const eligibleAuctions = auctions.filter(
    (auction) =>
      auction.status !== "CANCELLED" &&
      inWindow(Date.parse(auction.endAt), window) &&
      Date.parse(auction.endAt) <= now,
  );
  const completedEligibleAuctions = eligibleAuctions.filter(
    (auction) => auction.status === "COMPLETED",
  );
  const activeUsers = new Set(
    userActivity
      .filter((activity) => inWindow(activity.timestamp, window))
      .map((activity) => activity.userId),
  );
  const responseDurations = requestSamples
    .filter((sample) => inWindow(sample.timestamp, window))
    .map((sample) => sample.durationMs)
    .filter((duration) => Number.isFinite(duration) && duration >= 0)
    .sort((left, right) => left - right);
  const processingDurations = periodBids
    .map((bid) => bid.processingMs)
    .filter((duration) => Number.isFinite(duration) && duration >= 0);
  const uniquePairs = new Set(
    acceptedBids.map((bid) => `${bid.auctionId}:${bid.bidderId}`),
  );
  const finalized = auctions.filter(
    (auction) =>
      auction.status === "COMPLETED" &&
      inWindow(Date.parse(auction.finalizedAt ?? auction.endAt), window) &&
      Number.isFinite(Date.parse(auction.startAt)) &&
      Number.isFinite(Date.parse(auction.finalizedAt ?? auction.endAt)),
  );
  const transactionByAuction = new Map(
    transactions.map((transaction) => [transaction.auctionId, transaction]),
  );
  const wonAuctionRecords = auctions.filter(
    (auction) =>
      auction.status === "COMPLETED" &&
      auction.winnerId !== null &&
      dateInWindow(auction.endAt, window),
  );
  const eligibleWonAuctions = wonAuctionRecords.filter((auction) => {
    const transaction = transactionByAuction.get(auction.id);
    const deadline = transaction?.transactionDeadlineAt
      ? Date.parse(transaction.transactionDeadlineAt)
      : Date.parse(transaction?.createdAt ?? auction.endAt) + TRANSACTION_DEADLINE_MS;
    return Number.isFinite(deadline) && deadline <= now;
  });
  const completedTransactions = eligibleWonAuctions.filter(
    (auction) => transactionByAuction.get(auction.id)?.status === "COMPLETED",
  ).length;
  const p95 = responseDurations.length
    ? responseDurations[Math.ceil(responseDurations.length * 0.95) - 1]
    : null;

  const standard: Metric[] = [
    metric(updatedAt, range, {
      id: "bid-success-rate",
      name: "Bid Success Rate",
      description: "Share of bid HTTP attempts accepted by the system.",
      formula: "(Accepted Bid Attempts / Total Bid Attempts) × 100",
      value: ratio(acceptedAttempts.length, attempts.length),
      unit: "%",
      status: attempts.length ? "AVAILABLE" : "INSUFFICIENT_DATA",
    }),
    metric(updatedAt, range, {
      id: "bid-rejection-rate",
      name: "Bid Rejection Rate",
      description: "Share of bid HTTP attempts rejected by authentication, validation, or auction rules.",
      formula: "(Rejected Bid Attempts / Total Bid Attempts) × 100",
      value: ratio(rejectedAttempts.length, attempts.length),
      unit: "%",
      status: attempts.length ? "AVAILABLE" : "INSUFFICIENT_DATA",
    }),
    metric(updatedAt, range, {
      id: "average-bids-per-auction",
      name: "Average Bids per Auction",
      description: "Bid attempts in the period divided by auctions created in the period.",
      formula: "Total Bid Attempts / Number of Auctions",
      value: avg(attempts.length, periodAuctions.length),
      unit: " bids",
      status: periodAuctions.length ? "AVAILABLE" : "INSUFFICIENT_DATA",
    }),
    metric(updatedAt, range, {
      id: "auction-completion-rate",
      name: "Auction Completion Rate",
      description: "Share of non-cancelled auctions whose scheduled close fell in the period and finalized.",
      formula: "(Completed Auctions / Auctions Eligible to End) × 100",
      value: ratio(completedEligibleAuctions.length, eligibleAuctions.length),
      unit: "%",
      status: eligibleAuctions.length ? "AVAILABLE" : "INSUFFICIENT_DATA",
      supportingStats: {
        completedAuctions: completedEligibleAuctions.length,
        eligibleAuctions: eligibleAuctions.length,
      },
    }),
    metric(updatedAt, range, {
      id: "average-auction-participation",
      name: "Average Auction Participation",
      description: "Distinct bidder-auction pairs divided by auctions created in the period.",
      formula: "Total Unique Bidder-Auction Pairs / Number of Auctions",
      value: avg(uniquePairs.size, periodAuctions.length),
      unit: " bidders",
      status: periodAuctions.length ? "AVAILABLE" : "INSUFFICIENT_DATA",
    }),
    metric(updatedAt, range, {
      id: "average-bid-processing-time",
      name: "Average Bid Processing Time",
      description: "Mean server-measured processing duration for persisted bid attempts.",
      formula: "Sum of Bid Processing Durations / Number of Processed Bid Requests",
      value: avg(processingDurations.reduce((sum, value) => sum + value, 0), processingDurations.length),
      unit: " ms",
      status: processingDurations.length ? "AVAILABLE" : "INSUFFICIENT_DATA",
    }),
    metric(updatedAt, range, {
      id: "average-auction-duration",
      name: "Average Auction Duration",
      description: "Mean scheduled elapsed time for finalized auctions in the selected close period.",
      formula: "Sum of Actual Auction Durations / Number of Finalized Auctions",
      value: (() => {
        const averageDurationMs = avg(
          finalized.reduce(
            (sum, auction) =>
              sum + Date.parse(auction.finalizedAt ?? auction.endAt) - Date.parse(auction.startAt),
            0,
          ),
          finalized.length,
        );
        return averageDurationMs === null ? null : rounded(averageDurationMs / 60_000);
      })(),
      unit: " min",
      status: finalized.length ? "AVAILABLE" : "INSUFFICIENT_DATA",
      supportingStats: {
        finalizedAuctions: finalized.length,
        legacyScheduledCloseFallbacks: finalized.filter((auction) => !auction.finalizedAt).length,
      },
    }),
    metric(updatedAt, range, {
      id: "user-activity-rate",
      name: "User Activity Rate",
      description: "Registered users with at least one recorded authenticated state-changing action in the period.",
      formula: "(Distinct Active Users / Registered Users) × 100",
      value: ratio(activeUsers.size, users.length),
      unit: "%",
      status: users.length ? "AVAILABLE" : "INSUFFICIENT_DATA",
      supportingStats: { activeUsers: activeUsers.size, registeredUsers: users.length },
    }),
    metric(updatedAt, range, {
      id: "system-response-time",
      name: "System Response Time",
      description: "Average duration across completed API requests, including supporting p95 latency.",
      formula: "Sum of API Response Durations / Number of Completed API Requests",
      value: avg(responseDurations.reduce((sum, value) => sum + value, 0), responseDurations.length),
      unit: " ms",
      status: responseDurations.length ? "AVAILABLE" : "INSUFFICIENT_DATA",
      supportingStats: { p95ResponseTimeMs: p95, completedRequests: responseDurations.length },
    }),
    metric(updatedAt, range, {
      id: "transaction-completion-rate",
      name: "Transaction Completion Rate",
      description: "Completed transactions among won auctions whose seven-day transaction deadline has passed.",
      formula: "(Successfully Completed Transactions / Won Auctions Eligible for Transaction) × 100",
      value: ratio(completedTransactions, eligibleWonAuctions.length),
      unit: "%",
      status: eligibleWonAuctions.length ? "AVAILABLE" : "INSUFFICIENT_DATA",
      supportingStats: {
        completedTransactions,
        eligibleWonAuctions: eligibleWonAuctions.length,
        deadlineDays: 7,
      },
    }),
  ];

  const auditedAttempts = periodBids.filter(
    (bid) => bid.validationAudit?.evaluated === true,
  );
  const acceptedAudit = auditedAttempts.filter((bid) => bid.validationAudit?.accepted);
  const rejectedAudit = auditedAttempts.filter(
    (bid) => bid.validationAudit?.accepted === false,
  );
  const auctionById = new Map(auctions.map((auction) => [auction.id, auction]));
  const acceptedCompliant = acceptedAudit.filter((bid) => {
    const audit = bid.validationAudit;
    return bid.status === "ACCEPTED" &&
      !!audit &&
      audit.rulesFailed.length === 0 &&
      bid.bidderId !== audit.sellerId &&
      ["UPCOMING", "LIVE", "ENDING_SOON"].includes(audit.auctionStatus) &&
      bid.amount + 0.000001 >= audit.currentPrice + audit.increment &&
      Date.parse(bid.placedAt) < Date.parse(auctionById.get(bid.auctionId)?.endAt ?? "");
  }).length;
  const accuratelyRejected = rejectedAudit.filter((bid) => {
    const audit = bid.validationAudit;
    if (bid.status !== "REJECTED" || !audit?.rulesFailed.length) return false;
    return audit.rulesFailed.every((rule) => {
      switch (rule) {
        case "seller-bid":
          return bid.bidderId === audit.sellerId;
        case "auction-closed":
          return audit.auctionStatus === "COMPLETED" || audit.auctionStatus === "CANCELLED";
        case "below-minimum":
          return bid.amount + 0.000001 < audit.currentPrice + audit.increment;
        case "concurrent-price-change":
          return bid.amount + 0.000001 < audit.currentPrice + audit.increment;
        default:
          return false;
      }
    });
  }).length;
  const timingCompliant = auditedAttempts.filter((bid) => {
    const audit = bid.validationAudit;
    if (!audit) return false;
    const endAt = Date.parse(auctionById.get(bid.auctionId)?.endAt ?? "");
    const afterClose = Number.isFinite(endAt) && Date.parse(bid.placedAt) >= endAt;
    return afterClose
      ? !audit.accepted && audit.rulesFailed.includes("auction-closed")
      : ["UPCOMING", "LIVE", "ENDING_SOON"].includes(audit.auctionStatus);
  }).length;
  const acceptedByAuction = new Map<string, BidRecord[]>();
  for (const bid of acceptedAudit) {
    const auctionBids = acceptedByAuction.get(bid.auctionId) ?? [];
    auctionBids.push(bid);
    acceptedByAuction.set(bid.auctionId, auctionBids);
  }
  const orderedAccepted = [...acceptedByAuction.values()].flatMap((auctionBids) =>
    auctionBids.sort(
      (left, right) =>
        left.sequence - right.sequence ||
        Date.parse(left.placedAt) - Date.parse(right.placedAt),
    ),
  );
  const orderConsistent = orderedAccepted.filter((bid, index, ordered) => {
    const previous = ordered[index - 1];
    if (!previous || previous.auctionId !== bid.auctionId) return true;
    const audit = bid.validationAudit;
    return !!audit &&
      Date.parse(bid.placedAt) >= Date.parse(previous.placedAt) &&
      bid.amount + 0.000001 >= audit.currentPrice + audit.increment;
  }).length;

  const engagementAuctions = periodAuctions.length;
  const engagementBidCount = acceptedBids.length;
  const eligibleBidderIds = new Set(
    users
      .filter((user) => user.role !== "ADMIN" && !user.isSuspended)
      .map((user) => user.id),
  );
  const activeBidderIds = new Set(
    acceptedBids
      .map((bid) => bid.bidderId)
      .filter((bidderId) => eligibleBidderIds.has(bidderId)),
  );
  const timeBinSize = range === "1h" || range === "24h" ? 60 * 60 * 1000 : DAY_MS;
  const knownStartTimes = [
    ...periodAuctions.map((auction) => Date.parse(auction.startAt)),
    ...acceptedBids.map((bid) => Date.parse(bid.placedAt)),
  ].filter(Number.isFinite);
  const timeWindowStart = window.start ?? knownStartTimes.reduce(
    (earliest, timestamp) => Math.min(earliest, timestamp),
    now,
  );
  const eligibleTimeBinKeys = new Set<string>();
  for (const auction of periodAuctions) {
    const auctionStart = Date.parse(auction.startAt);
    const auctionEnd = Date.parse(auction.endAt);
    if (!Number.isFinite(auctionStart) || !Number.isFinite(auctionEnd)) continue;
    const start = Math.max(timeWindowStart, auctionStart);
    const end = Math.min(window.end, auctionEnd);
    for (
      let bin = Math.floor(start / timeBinSize);
      end > start && bin <= Math.floor((end - 1) / timeBinSize);
      bin += 1
    ) {
      eligibleTimeBinKeys.add(`${auction.id}:${bin}`);
    }
  }
  const activeTimeBins = new Set(
    acceptedBids
      .map((bid) => `${bid.auctionId}:${Math.floor(Date.parse(bid.placedAt) / timeBinSize)}`)
      .filter((key) => eligibleTimeBinKeys.has(key)),
  ).size;
  const eligibleTimeBins = eligibleTimeBinKeys.size;
  const engagementComponents = [
    {
      key: "unique-bidder-participation",
      name: "Unique-bidder participation (U)",
      value: engagementAuctions
        ? ratio(activeBidderIds.size, eligibleBidderIds.size)
        : null,
      weight: 40,
      description: "Distinct active bidders divided by registered, non-admin, non-suspended users.",
    },
    {
      key: "bid-activity",
      name: "Bid activity (B)",
      value: engagementAuctions
        ? Math.min(100, rounded(engagementBidCount / engagementAuctions / 20 * 100))
        : null,
      weight: 40,
      description: "Accepted bids per auction, normalized to 20 bids per auction.",
    },
    {
      key: "time-participation",
      name: "Time-based participation (T)",
      value: eligibleTimeBins > 0
        ? Math.min(100, rounded(activeTimeBins / eligibleTimeBins * 100))
        : null,
      weight: 20,
      description: "Auction-hour/day bins containing accepted bids divided by eligible auction bins.",
    },
  ];
  const engagementScore = engagementComponents.every((component) => component.value !== null)
    ? rounded(engagementComponents.reduce(
        (sum, component) => sum + (component.value ?? 0) * component.weight / 100,
        0,
      ))
    : null;
  const fairnessComponents = [
    {
      key: "valid-bid-compliance",
      name: "Valid bid compliance (V)",
      value: ratio(acceptedCompliant, auditedAttempts.length),
      weight: 35,
      description: "Audited attempts correctly accepted as valid, divided by all audited bid attempts.",
    },
    {
      key: "rejection-accuracy",
      name: "Rejection accuracy (R)",
      value: ratio(acceptedCompliant + accuratelyRejected, auditedAttempts.length),
      weight: 25,
      description: "Correct acceptances plus correct rejections, divided by all audited bid attempts.",
    },
    {
      key: "timing-compliance",
      name: "Timing compliance (T)",
      value: ratio(timingCompliant, auditedAttempts.length),
      weight: 20,
      description: "Audited decisions consistent with scheduled start and end rules, divided by audited attempts.",
    },
    {
      key: "bid-order-consistency",
      name: "Bid-order consistency (O)",
      value: ratio(orderConsistent, acceptedAudit.length),
      weight: 20,
      description: "Accepted bids in sequence order with nondecreasing timestamps and valid minimum increments.",
    },
  ];
  const fairnessScore = auditedAttempts.length > 0 &&
    fairnessComponents.every((component) => component.value !== null)
    ? rounded(fairnessComponents.reduce(
        (sum, component) => sum + (component.value ?? 0) * component.weight / 100,
        0,
      ))
    : null;
  const custom: Metric[] = [
    metric(updatedAt, range, {
      id: "bidding-engagement-score",
      name: "Bidding Engagement Score (BES)",
      description: "Project-specific normalized mix of bidder participation, bid activity, and time-based participation.",
      formula: "BES = (0.4 × U) + (0.4 × B) + (0.2 × T)",
      value: engagementScore,
      unit: "/ 100",
      status: engagementScore === null ? "INSUFFICIENT_DATA" : "AVAILABLE",
      components: engagementComponents,
    }),
    metric(updatedAt, range, {
      id: "auction-fairness-score",
      name: "Auction Fairness Score (AFS)",
      description: "Project-specific operational indicator; not proof of legal or absolute fairness.",
      formula: "AFS = (0.35 × V) + (0.25 × R) + (0.20 × T) + (0.20 × O)",
      value: fairnessScore,
      unit: "/ 100",
      status: fairnessScore === null ? "INSUFFICIENT_DATA" : "AVAILABLE",
      components: fairnessComponents,
      supportingStats: { auditedBidAttempts: auditedAttempts.length },
    }),
  ];

  return {
    range,
    period,
    updatedAt,
    standard,
    custom,
    overview: {
      registeredUsers: users.length,
      auctions: periodAuctions.length,
      bidAttempts: attempts.length,
      acceptedBids: acceptedAttempts.length,
      rejectedBids: rejectedAttempts.length,
      completedAuctions: completedEligibleAuctions.length,
    },
    trends: makeTrends(range, window, attempts, requestSamples, now),
  };
}

function makeTrends(
  range: MetricsRange,
  window: Window,
  attempts: RequestSample[],
  samples: RequestSample[],
  now: number,
) {
  const firstKnown = samples.reduce(
    (earliest, sample) => Number.isFinite(sample.timestamp)
      ? Math.min(earliest, sample.timestamp)
      : earliest,
    now,
  );
  const start = window.start ?? (Number.isFinite(firstKnown) ? firstKnown : now - DAY_MS);
  const span = Math.max(1, now - start);
  const bucketSize = Math.max(60_000, Math.ceil(span / 12));
  const buckets = Array.from({ length: 12 }, (_, index) => {
    const end = start + (index + 1) * bucketSize;
    const from = start + index * bucketSize;
    const values = attempts.filter((sample) => sample.timestamp >= from && sample.timestamp < end);
    const requestValues = samples.filter((sample) => sample.timestamp >= from && sample.timestamp < end);
    const label = range === "1h" || range === "24h"
      ? new Date(end).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
      : new Date(end).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return {
      label,
      bidAttempts: values.length,
      acceptedBids: values.filter(isSuccessfulAttempt).length,
      rejectedBids: values.filter((sample) => !isSuccessfulAttempt(sample)).length,
      averageResponseMs: avg(
        requestValues.reduce((sum, sample) => sum + sample.durationMs, 0),
        requestValues.length,
      ),
    };
  });
  return buckets;
}

export function getSoftwareMetrics(range: MetricsRange, now = Date.now()) {
  return makeSnapshot(range, now);
}

export function parseMetricsRange(value: unknown): MetricsRange | null {
  if (value === undefined) return "24h";
  return typeof value === "string" && METRIC_RANGES.includes(value as MetricsRange)
    ? value as MetricsRange
    : null;
}
