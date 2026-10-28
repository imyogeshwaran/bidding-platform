import { Router, type IRouter, type Response } from "express";
import {
  CreateAuctionBody,
  CreateAuctionResponse,
  ExitAuctionParams,
  GetAuctionBidsParams,
  GetAuctionBidsResponse,
  GetAuctionParams,
  GetAuctionResponse,
  GetAuctionsQueryParams,
  GetAuctionsResponse,
  GetMyBidsResponse,
  PlaceBidBody,
  PlaceBidParams,
  PlaceBidResponse,
} from "@workspace/api-zod";
import { allowRoles, authenticate, getAuthenticatedUser } from "../middlewares/auth";
import { logger } from "../lib/logger";
import { publishAuctionUpdate } from "../lib/realtime";
import {
  acceptBidAtomically,
  exitAuctionAtomically,
  persistBidSideEffects,
  readAuction,
} from "../repositories/mongo-store";
import {
  addActivity,
  addNotification,
  auctions,
  bids,
  createId,
  transactions,
  userActivity,
  users,
  type AuctionRecord,
  type AuctionStatus,
  type BidRecord,
} from "../repositories/memory-store";

const router: IRouter = Router();
const ENDING_SOON_MS = 60 * 60 * 1000;
const MAX_IMAGE_UPLOAD_BYTES = 3_500_000;

function isSupportedImageDataUrl(value: string): boolean {
  const match = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(value);
  if (!match) return false;

  const [, type, encoded] = match;
  const bytes = Buffer.from(encoded, "base64");
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_IMAGE_UPLOAD_BYTES ||
    bytes.toString("base64") !== encoded
  ) {
    return false;
  }

  switch (type.toLowerCase()) {
    case "png":
      return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    case "jpeg":
      return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "gif":
      return bytes.subarray(0, 6).toString("ascii").match(/^GIF8[79]a$/) !== null;
    case "webp":
      return bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
        bytes.subarray(8, 12).toString("ascii") === "WEBP";
    default:
      return false;
  }
}

function error(
  response: Response,
  status: number,
  code: string,
  message: string,
  persistStateOnError = false,
): void {
  response.locals.persistStateOnError = persistStateOnError;
  response.status(status).json({ success: false, error: { code, message } });
}

function acceptedBidsFor(auctionId: string): BidRecord[] {
  const auction = auctions.find((candidate) => candidate.id === auctionId);
  const exitedBidderIds = new Set(auction?.exitedBidderIds ?? []);
  return bids
    .filter(
      (bid) =>
        bid.auctionId === auctionId &&
        bid.status === "ACCEPTED" &&
        !exitedBidderIds.has(bid.bidderId),
    )
    .sort(
      (left, right) =>
        right.amount - left.amount ||
        Date.parse(left.placedAt) - Date.parse(right.placedAt),
    );
}

function announceAuctionClosed(auction: AuctionRecord, winningBid?: BidRecord): void {
  if (winningBid) {
    const buyer = users.find((user) => user.id === winningBid.bidderId);
    const alreadyCreated = transactions.some(
      (transaction) => transaction.auctionId === auction.id,
    );
    if (!alreadyCreated && buyer) {
      transactions.push({
        id: createId(),
        auctionId: auction.id,
        auctionTitle: auction.title,
        buyerId: buyer.id,
        buyerName: buyer.name,
        sellerId: auction.sellerId,
        sellerName: auction.sellerName,
        finalPrice: winningBid.amount,
        status: "PENDING",
        paymentStatus: "NOT_STARTED",
        createdAt: new Date().toISOString(),
        transactionDeadlineAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      });
      addNotification(
        buyer.id,
        "AUCTION_WON",
        "You won the auction",
        `${auction.title} closed at $${winningBid.amount.toFixed(2)}.`,
        auction.id,
      );
    }
    const participantIds = new Set(
      bids
        .filter((bid) => bid.auctionId === auction.id && bid.status === "ACCEPTED")
        .map((bid) => bid.bidderId),
    );
    for (const participantId of participantIds) {
      if (participantId === winningBid.bidderId) continue;
      addNotification(
        participantId,
        "AUCTION_LOST",
        "Auction closed",
        `${auction.title} has ended.`,
        auction.id,
      );
    }
  }

  addNotification(
    auction.sellerId,
    "AUCTION_ENDED",
    "Your auction has ended",
    winningBid
      ? `${auction.title} closed at $${winningBid.amount.toFixed(2)}.`
      : `${auction.title} ended without bids.`,
    auction.id,
  );
  addActivity(
    "Auction closed",
    `${auction.title} ${winningBid ? `closed at $${winningBid.amount.toFixed(2)}` : "ended without bids"}`,
    "auction",
  );
}

function closeAuction(auction: AuctionRecord): void {
  if (auction.status === "COMPLETED" || auction.status === "CANCELLED") return;

  const winningBid = acceptedBidsFor(auction.id)[0];
  auction.status = "COMPLETED";
  auction.finalizedAt = new Date().toISOString();
  auction.winnerId = winningBid?.bidderId ?? null;
  auction.currentPrice = winningBid?.amount ?? auction.startingPrice;
  announceAuctionClosed(auction, winningBid);
}

export function refreshAuctionStatus(auction: AuctionRecord): AuctionStatus {
  if (auction.status === "CANCELLED" || auction.status === "COMPLETED") {
    return auction.status;
  }

  const now = Date.now();
  const startAt = Date.parse(auction.startAt);
  const endAt = Date.parse(auction.endAt);
  if (now >= endAt) {
    closeAuction(auction);
    return auction.status;
  }
  if (now < startAt) {
    auction.status = "UPCOMING";
    return auction.status;
  }
  auction.status = endAt - now <= ENDING_SOON_MS ? "ENDING_SOON" : "LIVE";
  return auction.status;
}

export function processScheduledAuctions(): AuctionRecord[] {
  const changed: AuctionRecord[] = [];
  for (const auction of auctions) {
    const previousStatus = auction.status;
    refreshAuctionStatus(auction);
    if (auction.status !== previousStatus) changed.push(auction);
  }
  return changed;
}

function publicBid(bid: BidRecord) {
  return {
    id: bid.id,
    auctionId: bid.auctionId,
    bidderId: bid.bidderId,
    bidderName: bid.bidderName,
    amount: bid.amount,
    status: bid.status,
    placedAt: bid.placedAt,
    sequence: bid.sequence,
    processingMs: bid.processingMs,
  };
}

function recordRejectedBid(
  auction: AuctionRecord,
  userId: string,
  bidderName: string,
  amount: number,
  reason: string,
  startedAt: number,
  rulesFailed: string[],
): BidRecord {
  const now = Date.now();
  const processingMs = Math.max(0, Number((performance.now() - startedAt).toFixed(2)));
  const rejected: BidRecord = {
    id: createId(),
    auctionId: auction.id,
    bidderId: userId,
    bidderName,
    amount,
    status: "REJECTED",
    placedAt: new Date(now).toISOString(),
    sequence: bids.filter((bid) => bid.auctionId === auction.id).length + 1,
    processingMs,
    rejectionReason: reason,
    validationAudit: {
      evaluated: true,
      accepted: false,
      rulesFailed,
      auctionStatus: auction.status,
      currentPrice: auction.currentPrice,
      increment: auction.increment,
      sellerId: auction.sellerId,
    },
    timing: {
      requestReceivedAt: startedAt,
      validationStartedAt: startedAt,
      validationCompletedAt: now,
      operationStart: now,
      operationEnd: now,
      responseSentAt: now,
    },
  };
  bids.push(rejected);
  addNotification(
    userId,
    "BID_REJECTED",
    "Bid not accepted",
    reason,
    auction.id,
  );
  addActivity("Bid rejected", `${bidderName}'s bid on ${auction.title} was rejected`, "bid", userId);
  return rejected;
}

router.get("/auctions", (request, response): void => {
  const parsed = GetAuctionsQueryParams.safeParse(request.query);
  if (!parsed.success) {
    error(response, 400, "INVALID_QUERY", "The auction filters are invalid.");
    return;
  }

  const { search = "", category, status = "ALL", sort = "endingSoon" } = parsed.data;
  const page = parsed.data.page ?? 1;
  const pageSize = parsed.data.pageSize ?? 12;
  let results = auctions.filter((auction) => {
    refreshAuctionStatus(auction);
    const matchesSearch =
      !search ||
      `${auction.title} ${auction.description} ${auction.category} ${auction.sellerName}`
        .toLowerCase()
        .includes(search.toLowerCase());
    const matchesCategory = !category || auction.category === category;
    const matchesStatus = status === "ALL" || auction.status === status;
    return matchesSearch && matchesCategory && matchesStatus;
  });

  results = [...results];
  switch (sort) {
    case "newest":
      results.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      break;
    case "mostBids":
      results.sort((a, b) => b.bidCount - a.bidCount);
      break;
    case "highestPrice":
      results.sort((a, b) => b.currentPrice - a.currentPrice);
      break;
    case "lowestPrice":
      results.sort((a, b) => a.currentPrice - b.currentPrice);
      break;
    default:
      results.sort((a, b) => Date.parse(a.endAt) - Date.parse(b.endAt));
  }

  const total = results.length;
  const data = results.slice((page - 1) * pageSize, page * pageSize);
  response.json(
    GetAuctionsResponse.parse({
      success: true,
      data,
      total,
      page,
      pageSize,
      message: "Auctions loaded.",
    }),
  );
});

router.post(
  "/auctions",
  authenticate,
  allowRoles("BUYER", "SELLER", "ADMIN"),
  (request, response): void => {
    const user = getAuthenticatedUser(response);
    const seller = users.find((candidate) => candidate.id === user?.id);
    const parsed = CreateAuctionBody.safeParse(request.body);
    if (!parsed.success) {
      error(response, 400, "INVALID_AUCTION", "Check the listing details and auction dates.");
      return;
    }
    if (!seller) {
      error(response, 401, "SESSION_EXPIRED", "Your session is no longer valid.");
      return;
    }

    const startAt = new Date(parsed.data.startAt);
    const endAt = new Date(parsed.data.endAt);
    if (
      Number.isNaN(startAt.getTime()) ||
      Number.isNaN(endAt.getTime()) ||
      endAt.getTime() <= startAt.getTime()
    ) {
      error(response, 400, "INVALID_DATES", "The closing time must be later than the opening time.");
      return;
    }
    const imageUrl = parsed.data.imageUrl.trim();
    let validImage = isSupportedImageDataUrl(imageUrl);
    if (!validImage) {
      try {
        const image = new URL(imageUrl);
        validImage = image.protocol === "https:" || image.protocol === "http:";
      } catch {
        validImage = false;
      }
    }
    if (!validImage) {
      error(response, 400, "INVALID_IMAGE_URL", "Enter a valid product image URL.");
      return;
    }

    const auction: AuctionRecord = {
      id: createId(),
      title: parsed.data.title.trim(),
      description: parsed.data.description.trim(),
      category: parsed.data.category.trim(),
      imageUrl,
      sellerId: seller.id,
      sellerName: seller.name,
      startingPrice: Math.round(parsed.data.startingPrice * 100) / 100,
      currentPrice: Math.round(parsed.data.startingPrice * 100) / 100,
      increment: Math.round(parsed.data.increment * 100) / 100,
      bidCount: 0,
      uniqueBidders: 0,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      status: "UPCOMING",
      winnerId: null,
      createdAt: new Date().toISOString(),
    };
    refreshAuctionStatus(auction);
    auctions.unshift(auction);
    addActivity("New auction", `${seller.name} listed ${auction.title}`, "auction", seller.id);
    response.status(201).json(
      CreateAuctionResponse.parse({
        success: true,
        data: auction,
        message: "Your listing is live.",
      }),
    );
  },
);

router.get("/auctions/:id", (request, response): void => {
  const params = GetAuctionParams.safeParse(request.params);
  if (!params.success) {
    error(response, 400, "INVALID_AUCTION_ID", "The auction ID is invalid.");
    return;
  }
  const auction = auctions.find((candidate) => candidate.id === params.data.id);
  if (!auction) {
    error(response, 404, "AUCTION_NOT_FOUND", "That auction could not be found.");
    return;
  }
  refreshAuctionStatus(auction);
  response.json(
    GetAuctionResponse.parse({
      success: true,
      data: auction,
      message: "Auction details loaded.",
    }),
  );
});

router.delete("/auctions/:id", authenticate, (request, response): void => {
  const user = getAuthenticatedUser(response);
  const auction = auctions.find((candidate) => candidate.id === request.params.id);
  if (!user) {
    error(response, 401, "AUTH_REQUIRED", "Sign in to manage this listing.");
    return;
  }
  if (!auction) {
    error(response, 404, "AUCTION_NOT_FOUND", "That auction could not be found.");
    return;
  }
  if (user.role !== "ADMIN" && auction.sellerId !== user.id) {
    error(response, 403, "FORBIDDEN", "Only the listing seller or an administrator can cancel this auction.");
    return;
  }
  if (auction.status === "COMPLETED" || auction.status === "CANCELLED") {
    error(response, 409, "AUCTION_CLOSED", "A completed or cancelled auction cannot be cancelled again.");
    return;
  }
  if (user.role !== "ADMIN" && auction.bidCount > 0) {
    error(response, 409, "BIDS_ALREADY_PLACED", "A seller cannot cancel a listing after bids have been placed. Contact an administrator for moderation.");
    return;
  }

  auction.status = "CANCELLED";
  addActivity("Auction cancelled", `${auction.title} was cancelled by ${user.role === "ADMIN" ? "an administrator" : auction.sellerName}.`, "auction", user.id);
  const participantIds = new Set(
    bids
      .filter((bid) => bid.auctionId === auction.id && bid.status === "ACCEPTED")
      .map((bid) => bid.bidderId),
  );
  for (const participantId of participantIds) {
    addNotification(
      participantId,
      "AUCTION_CANCELLED",
      "Auction cancelled",
      `${auction.title} was cancelled by the marketplace team.`,
      auction.id,
    );
  }
  response.json({
    success: true,
    data: auction,
    message: "Auction cancelled.",
  });
});

router.post(
  "/auctions/:auctionId/exit",
  authenticate,
  allowRoles("BUYER", "SELLER"),
  async (request, response): Promise<void> => {
    const params = ExitAuctionParams.safeParse(request.params);
    if (!params.success) {
      error(response, 400, "INVALID_AUCTION_ID", "The auction ID is invalid.");
      return;
    }
    const user = getAuthenticatedUser(response);
    if (!user) {
      error(response, 401, "AUTH_REQUIRED", "Sign in to exit an auction.");
      return;
    }

    const outcome = await exitAuctionAtomically(params.data.auctionId, user.id);
    if (outcome.kind !== "EXITED") {
      const statusByKind = {
        NOT_FOUND: 404,
        CLOSED: 409,
        NOT_PARTICIPANT: 403,
        ALREADY_EXITED: 409,
        LEADING: 409,
      } as const;
      const messageByKind = {
        NOT_FOUND: "That auction could not be found.",
        CLOSED: "This auction is no longer active.",
        NOT_PARTICIPANT: "Place an accepted bid before exiting this auction.",
        ALREADY_EXITED: "You have already exited. Place another bid to rejoin.",
        LEADING: "You cannot exit while you are leading. Exit is available once another bidder overtakes you.",
      } as const;
      error(
        response,
        statusByKind[outcome.kind],
        outcome.kind,
        messageByKind[outcome.kind],
      );
      return;
    }

    const auction = auctions.find((candidate) => candidate.id === outcome.auction.id);
    if (!auction) {
      error(response, 404, "AUCTION_NOT_FOUND", "That auction could not be found.");
      return;
    }
    Object.assign(auction, outcome.auction);
    if (outcome.closed) {
      announceAuctionClosed(auction, outcome.winningBid ?? undefined);
    }
    const bidderName = users.find((candidate) => candidate.id === user.id)?.name ?? "A buyer";
    addActivity(
      "Bidder exited",
      `${bidderName} exited ${auction.title}${outcome.closed ? "; the last remaining bidder won" : ""}.`,
      "auction",
      user.id,
    );
    publishAuctionUpdate(auction.id, { auctionId: auction.id, auction });
    response.json(
      GetAuctionResponse.parse({
        success: true,
        data: auction,
        message: outcome.closed
          ? "You exited. The last remaining bidder won the auction."
          : "You exited this auction. Place another bid to rejoin.",
      }),
    );
  },
);

router.get("/auctions/:auctionId/bids", (request, response): void => {
  const params = GetAuctionBidsParams.safeParse(request.params);
  if (!params.success) {
    error(response, 400, "INVALID_AUCTION_ID", "The auction ID is invalid.");
    return;
  }
  const auction = auctions.find((candidate) => candidate.id === params.data.auctionId);
  if (!auction) {
    error(response, 404, "AUCTION_NOT_FOUND", "That auction could not be found.");
    return;
  }

  const history = bids
    .filter((bid) => bid.auctionId === auction.id)
    .sort((a, b) => Date.parse(b.placedAt) - Date.parse(a.placedAt))
    .map(publicBid);
  response.json(
    GetAuctionBidsResponse.parse({
      success: true,
      data: history,
      message: "Bid history loaded.",
    }),
  );
});

router.post(
  "/auctions/:auctionId/bids",
  authenticate,
  allowRoles("BUYER", "SELLER"),
  async (request, response): Promise<void> => {
    const requestStartedAt = performance.now();
    const params = PlaceBidParams.safeParse(request.params);
    const parsed = PlaceBidBody.safeParse(request.body);
    if (!params.success || !parsed.success) {
      error(response, 400, "INVALID_BID", "Enter a valid bid amount.");
      return;
    }

    const user = getAuthenticatedUser(response);
    const bidder = users.find((candidate) => candidate.id === user?.id);
    const auction = auctions.find((candidate) => candidate.id === params.data.auctionId);
    if (!bidder || !user) {
      error(response, 401, "SESSION_EXPIRED", "Sign in again before bidding.");
      return;
    }
    if (!auction) {
      error(response, 404, "AUCTION_NOT_FOUND", "That auction could not be found.");
      return;
    }

    const status = refreshAuctionStatus(auction);
    const amount = Math.round(parsed.data.amount * 100) / 100;
    let rejectionReason = "";
    const rulesFailed: string[] = [];
    if (auction.sellerId === bidder.id) {
      rejectionReason = "Sellers cannot bid on their own auctions.";
      rulesFailed.push("seller-bid");
    } else if (status === "COMPLETED" || status === "CANCELLED") {
      rejectionReason = "This auction is no longer accepting bids.";
      rulesFailed.push("auction-closed");
    } else if (amount + 0.000001 < auction.currentPrice + auction.increment) {
      rejectionReason = `The minimum acceptable bid is $${(auction.currentPrice + auction.increment).toFixed(2)}.`;
      rulesFailed.push("below-minimum");
    }

    if (rejectionReason) {
      recordRejectedBid(auction, bidder.id, bidder.name, amount, rejectionReason, requestStartedAt, rulesFailed);
      error(response, 400, "BID_REJECTED", rejectionReason, true);
      return;
    }

    const previousLeader = acceptedBidsFor(auction.id)[0];
    const now = Date.now();
    const validationFinishedAt = performance.now();
    const operationStartedAt = performance.now();
    const bid: BidRecord = {
      id: createId(),
      auctionId: auction.id,
      bidderId: bidder.id,
      bidderName: bidder.name,
      amount,
      status: "ACCEPTED",
      placedAt: new Date(now).toISOString(),
      sequence: bids.filter((candidate) => candidate.auctionId === auction.id).length + 1,
      processingMs: 0,
      rejectionReason: null,
      validationAudit: {
        evaluated: true,
        accepted: true,
        rulesFailed: [],
        auctionStatus: status,
        currentPrice: auction.currentPrice,
        increment: auction.increment,
        sellerId: auction.sellerId,
      },
      timing: {
        requestReceivedAt: requestStartedAt,
        validationStartedAt: requestStartedAt,
        validationCompletedAt: validationFinishedAt,
        operationStart: operationStartedAt,
        operationEnd: operationStartedAt,
        responseSentAt: performance.now(),
      },
    };
    let persistedAuction: AuctionRecord | null;
    try {
      persistedAuction = await acceptBidAtomically(
        auction.id,
        auction.currentPrice,
        amount,
        bidder.id,
        bid,
      );
    } catch (err) {
      logger.error({ err, auctionId: auction.id }, "Failed to persist accepted bid");
      error(
        response,
        503,
        "BID_STORAGE_UNAVAILABLE",
        "Bidding is temporarily unavailable because the bid could not be confirmed. Refresh the auction before trying again.",
      );
      return;
    }
    if (!persistedAuction) {
      let currentAuction: AuctionRecord | null;
      try {
        currentAuction = await readAuction(auction.id);
      } catch (err) {
        logger.error({ err, auctionId: auction.id }, "Failed to refresh auction after bid conflict");
        error(
          response,
          503,
          "BID_STORAGE_UNAVAILABLE",
          "Bidding is temporarily unavailable because the current bid could not be confirmed. Refresh the auction before trying again.",
        );
        return;
      }
      if (currentAuction) Object.assign(auction, currentAuction);
      refreshAuctionStatus(auction);
      const latestMinimum = auction.currentPrice + auction.increment;
      const staleReason = `The bid changed while you were bidding. The current minimum is $${latestMinimum.toFixed(2)}.`;
      recordRejectedBid(auction, bidder.id, bidder.name, amount, staleReason, requestStartedAt, ["concurrent-price-change"]);
      error(response, 409, "BID_OUTDATED", staleReason, true);
      return;
    }

    Object.assign(auction, persistedAuction);
    bids.push(bid);
    bid.processingMs = Math.max(0, Number((performance.now() - requestStartedAt).toFixed(2)));
    bid.timing.operationEnd = performance.now();
    bid.timing.responseSentAt = performance.now();

    const bidNotifications = [
      addNotification(
        bidder.id,
        "BID_ACCEPTED",
        "Your bid is in",
        `Your $${amount.toFixed(2)} bid on ${auction.title} was accepted.`,
        auction.id,
      ),
    ];
    if (previousLeader && previousLeader.bidderId !== bidder.id) {
      bidNotifications.push(
        addNotification(
          previousLeader.bidderId,
          "BID_SURPASSED",
          "You have been outbid",
          `A new bid was placed on ${auction.title}.`,
          auction.id,
        ),
      );
    }
    const activity = addActivity(
      "Bid accepted",
      `${bidder.name} bid $${amount.toFixed(2)} on ${auction.title}`,
      "bid",
      bidder.id,
    );
    const activityUser = userActivity[userActivity.length - 1];
    if (!activityUser) {
      throw new Error("Bid activity was created without its user activity record.");
    }
    response.locals.bidStatePersisted = true;
    let sideEffectsDelayed = false;
    try {
      await persistBidSideEffects(bidNotifications, activity, activityUser);
    } catch (err) {
      sideEffectsDelayed = true;
      logger.error(
        { err, auctionId: auction.id, bidId: bid.id },
        "Bid was accepted but related activity could not be persisted",
      );
    }
    publishAuctionUpdate(auction.id, { auctionId: auction.id, auction, bid: publicBid(bid) });

    response.status(201).json(
      PlaceBidResponse.parse({
        success: true,
        data: publicBid(bid),
        message: sideEffectsDelayed
          ? "Your bid was accepted. Related notifications may be delayed."
          : "Your bid was accepted.",
      }),
    );
  },
);

router.get("/users/me/bids", authenticate, (request, response): void => {
  const user = getAuthenticatedUser(response);
  if (!user) {
    error(response, 401, "AUTH_REQUIRED", "Sign in to view your bids.");
    return;
  }

  const data = bids
    .filter((bid) => bid.bidderId === user.id)
    .sort((a, b) => Date.parse(b.placedAt) - Date.parse(a.placedAt))
    .flatMap((bid) => {
      const auction = auctions.find((candidate) => candidate.id === bid.auctionId);
      if (!auction) return [];
      refreshAuctionStatus(auction);
      const leading = acceptedBidsFor(auction.id)[0]?.bidderId === user.id;
      return [{ bid: publicBid(bid), auction, leading }];
    });

  response.json(
    GetMyBidsResponse.parse({
      success: true,
      data,
      message: "Your bid activity loaded.",
    }),
  );
});

export default router;
