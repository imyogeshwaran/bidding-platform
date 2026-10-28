import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { auctions } from "../repositories/memory-store";

let realtimeServer: Server | undefined;

export function attachRealtime(server: HttpServer): void {
  realtimeServer = new Server(server, { cors: { origin: true } });
  realtimeServer.on("connection", (socket) => {
    void socket.join("auctions");
    socket.on("auction:join", (auctionId: unknown) => {
      if (
        typeof auctionId === "string" &&
        auctions.some((auction) => auction.id === auctionId)
      ) {
        void socket.join(`auction:${auctionId}`);
      }
    });
  });
}

export function publishAuctionUpdate(auctionId: string, update: unknown): void {
  realtimeServer
    ?.to(["auctions", `auction:${auctionId}`])
    .emit("auction:updated", update);
}