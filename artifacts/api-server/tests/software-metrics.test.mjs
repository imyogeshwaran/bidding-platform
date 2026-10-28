import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, before, beforeEach, test } from "node:test";
import { build } from "esbuild";

const tempDirectory = await mkdtemp(join(tmpdir(), "auction-software-metrics-"));
const fixturePath = join(tempDirectory, "fixture.mjs");
await build({
  entryPoints: [join(dirname(fileURLToPath(import.meta.url)), "software-metrics-fixture.ts")],
  outfile: fixturePath,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
});
const fixture = await import(pathToFileURL(fixturePath).href);
const now = Date.UTC(2026, 9, 27, 12);

function resetRecords() {
  for (const records of [
    fixture.auctions,
    fixture.bids,
    fixture.requestSamples,
    fixture.transactions,
    fixture.userActivity,
    fixture.users,
  ]) records.splice(0);
}

function metric(snapshot, id) {
  const result = snapshot.standard.find((item) => item.id === id);
  assert.ok(result, `Missing metric ${id}`);
  return result;
}

beforeEach(resetRecords);
after(async () => rm(tempDirectory, { recursive: true, force: true }));

test("validates supported metric ranges and defaults to 24 hours", () => {
  assert.equal(fixture.parseMetricsRange(undefined), "24h");
  assert.equal(fixture.parseMetricsRange("7d"), "7d");
  assert.equal(fixture.parseMetricsRange("yesterday"), null);
});

test("returns unavailable values instead of false zeroes for empty denominators", () => {
  const snapshot = fixture.getSoftwareMetrics("24h", now);
  assert.equal(metric(snapshot, "bid-success-rate").value, null);
  assert.equal(metric(snapshot, "bid-success-rate").status, "INSUFFICIENT_DATA");
  assert.equal(metric(snapshot, "average-auction-duration").value, null);
  assert.equal(snapshot.custom.find((item) => item.id === "auction-fairness-score").value, null);
});

test("calculates persisted event formulas and honors the selected time window", () => {
  const closedAt = now - 60 * 60 * 1000;
  fixture.users.push(
    { id: "buyer-1", role: "BUYER", createdAt: new Date(now - 10 * 60_000).toISOString() },
    { id: "buyer-2", role: "BUYER", createdAt: new Date(now - 10 * 60_000).toISOString() },
  );
  fixture.auctions.push({
    id: "auction-1",
    title: "Test lot",
    category: "test",
    description: "Test fixture auction",
    imageUrl: "",
    sellerId: "seller-1",
    sellerName: "Seller",
    startingPrice: 10,
    currentPrice: 15,
    increment: 1,
    bidCount: 2,
    uniqueBidders: 1,
    startAt: new Date(closedAt - 2 * 60 * 60 * 1000).toISOString(),
    endAt: new Date(closedAt).toISOString(),
    finalizedAt: new Date(closedAt).toISOString(),
    status: "COMPLETED",
    winnerId: "buyer-1",
    createdAt: new Date(closedAt - 3 * 60 * 60 * 1000).toISOString(),
  });
  fixture.bids.push(
    {
      id: "accepted-1",
      auctionId: "auction-1",
      bidderId: "buyer-1",
      bidderName: "Buyer",
      amount: 15,
      status: "ACCEPTED",
      placedAt: new Date(closedAt - 30 * 60_000).toISOString(),
      sequence: 1,
      processingMs: 10,
      rejectionReason: null,
      validationAudit: {
        evaluated: true,
        accepted: true,
        rulesFailed: [],
        auctionStatus: "LIVE",
        currentPrice: 10,
        increment: 1,
        sellerId: "seller-1",
      },
      timing: {
        requestReceivedAt: 0,
        validationStartedAt: 0,
        validationCompletedAt: 0,
        operationStart: 0,
        operationEnd: 0,
        responseSentAt: 0,
      },
    },
    {
      id: "rejected-1",
      auctionId: "auction-1",
      bidderId: "buyer-2",
      bidderName: "Buyer 2",
      amount: 5,
      status: "REJECTED",
      placedAt: new Date(closedAt - 20 * 60_000).toISOString(),
      sequence: 2,
      processingMs: 20,
      rejectionReason: "Below minimum",
      validationAudit: {
        evaluated: true,
        accepted: false,
        rulesFailed: ["below-minimum"],
        auctionStatus: "LIVE",
        currentPrice: 10,
        increment: 1,
        sellerId: "seller-1",
      },
      timing: {
        requestReceivedAt: 0,
        validationStartedAt: 0,
        validationCompletedAt: 0,
        operationStart: 0,
        operationEnd: 0,
        responseSentAt: 0,
      },
    },
    {
      id: "legacy-rejected",
      auctionId: "auction-1",
      bidderId: "buyer-2",
      bidderName: "Buyer 2",
      amount: 5,
      status: "REJECTED",
      placedAt: new Date(closedAt - 10 * 60_000).toISOString(),
      sequence: 3,
      processingMs: 30,
      rejectionReason: "Legacy record without validation audit",
      timing: {
        requestReceivedAt: 0,
        validationStartedAt: 0,
        validationCompletedAt: 0,
        operationStart: 0,
        operationEnd: 0,
        responseSentAt: 0,
      },
    },
  );
  fixture.requestSamples.push(
    { id: "attempt-1", method: "POST", endpoint: "/api/auctions/auction-1/bids", statusCode: 201, durationMs: 10, timestamp: closedAt - 30 * 60_000 },
    { id: "attempt-2", method: "POST", endpoint: "/api/auctions/auction-1/bids", statusCode: 400, durationMs: 20, timestamp: closedAt - 20 * 60_000 },
    { id: "api-1", method: "GET", endpoint: "/api/healthz", statusCode: 200, durationMs: 15, timestamp: closedAt - 10 * 60_000 },
  );
  fixture.transactions.push({
    id: "transaction-1",
    auctionId: "auction-1",
    auctionTitle: "Test lot",
    buyerId: "buyer-1",
    buyerName: "Buyer",
    sellerId: "seller-1",
    sellerName: "Seller",
    finalPrice: 15,
    status: "COMPLETED",
    paymentStatus: "PAID",
    createdAt: new Date(closedAt).toISOString(),
    transactionDeadlineAt: new Date(now - 60_000).toISOString(),
  });
  fixture.userActivity.push({ userId: "buyer-1", timestamp: closedAt });

  const snapshot = fixture.getSoftwareMetrics("all", now);
  assert.equal(metric(snapshot, "bid-success-rate").value, 50);
  assert.equal(metric(snapshot, "bid-rejection-rate").value, 50);
  assert.equal(metric(snapshot, "average-bids-per-auction").value, 2);
  assert.equal(metric(snapshot, "auction-completion-rate").value, 100);
  assert.equal(metric(snapshot, "average-auction-participation").value, 1);
  assert.equal(metric(snapshot, "average-bid-processing-time").value, 20);
  assert.equal(metric(snapshot, "average-auction-duration").value, 120);
  assert.equal(metric(snapshot, "user-activity-rate").value, 50);
  assert.equal(metric(snapshot, "system-response-time").value, 15);
  assert.equal(metric(snapshot, "system-response-time").supportingStats.p95ResponseTimeMs, 20);
  assert.equal(metric(snapshot, "transaction-completion-rate").value, 100);
  const engagement = snapshot.custom.find((item) => item.id === "bidding-engagement-score");
  assert.equal(engagement.components.find((component) => component.key === "unique-bidder-participation").value, 50);
  assert.equal(engagement.components.find((component) => component.key === "bid-activity").value, 5);
  assert.equal(engagement.components.find((component) => component.key === "time-participation").value, 100);
  assert.equal(engagement.value, 42);
  const fairness = snapshot.custom.find((item) => item.id === "auction-fairness-score");
  assert.equal(fairness.components.find((component) => component.key === "valid-bid-compliance").value, 50);
  assert.equal(fairness.components.find((component) => component.key === "rejection-accuracy").value, 100);
  assert.equal(fairness.components.find((component) => component.key === "timing-compliance").value, 100);
  assert.equal(fairness.components.find((component) => component.key === "bid-order-consistency").value, 100);
  assert.equal(fairness.supportingStats.auditedBidAttempts, 2);
  assert.equal(fairness.value, 82.5);
  assert.equal(fixture.getSoftwareMetrics("1h", now).overview.bidAttempts, 0);
});

test("holds recently won transactions out of the eligible denominator", () => {
  const auctionEnd = now - 60 * 60 * 1000;
  fixture.auctions.push({
    id: "recent-win",
    title: "Recent",
    category: "test",
    description: "Recently ended",
    imageUrl: "",
    sellerId: "seller",
    sellerName: "Seller",
    startingPrice: 1,
    currentPrice: 2,
    increment: 1,
    bidCount: 1,
    uniqueBidders: 1,
    startAt: new Date(auctionEnd - 60 * 60 * 1000).toISOString(),
    endAt: new Date(auctionEnd).toISOString(),
    status: "COMPLETED",
    winnerId: "buyer",
    createdAt: new Date(auctionEnd - 2 * 60 * 60 * 1000).toISOString(),
  });
  fixture.transactions.push({
    id: "recent-transaction",
    auctionId: "recent-win",
    auctionTitle: "Recent",
    buyerId: "buyer",
    buyerName: "Buyer",
    sellerId: "seller",
    sellerName: "Seller",
    finalPrice: 2,
    status: "PENDING",
    paymentStatus: "PENDING",
    createdAt: new Date(auctionEnd).toISOString(),
    transactionDeadlineAt: new Date(auctionEnd + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });
  const result = metric(fixture.getSoftwareMetrics("all", now), "transaction-completion-rate");
  assert.equal(result.value, null);
  assert.equal(result.supportingStats.eligibleWonAuctions, 0);
});

test("demo data provides calculated values for every standard and custom metric", () => {
  assert.equal(fixture.seedMetricsDemoData(now), 4);
  const snapshot = fixture.getSoftwareMetrics("all", now);
  assert.equal(snapshot.standard.length, 10);
  assert.equal(snapshot.custom.length, 2);
  assert.ok(snapshot.standard.every((item) => item.status === "AVAILABLE"));
  assert.ok(snapshot.custom.every((item) => item.status === "AVAILABLE"));
  assert.equal(metric(snapshot, "bid-success-rate").value, 72.73);
  assert.equal(metric(snapshot, "bid-rejection-rate").value, 27.27);
  assert.equal(metric(snapshot, "transaction-completion-rate").value, 50);
  assert.equal(snapshot.overview.auctions, 4);
  assert.equal(snapshot.overview.bidAttempts, 11);
  assert.equal(fixture.seedMetricsDemoData(now), 0);
});
