import type { Server } from "socket.io";
import { ADMIN_PAYMENT_MONITOR_ROOM, auctionUserRoom } from "./auction-socket.service";

export type PaymentSocketEvent =
  | "payment:request-created"
  | "payment:initiated"
  | "payment:succeeded"
  | "payment:failed"
  | "payment:expired"
  | "sale-closing:pending"
  | "sale-closing:completed";

export function broadcastPaymentEvent(
  io: Server,
  event: PaymentSocketEvent,
  recipients: { buyerId: string; sellerId: string },
  privatePayload: Record<string, unknown>,
  adminPayload: Record<string, unknown>
): void {
  for (const userId of new Set([recipients.buyerId, recipients.sellerId])) {
    io.to(auctionUserRoom(userId)).emit(event, privatePayload);
  }
  io.to(ADMIN_PAYMENT_MONITOR_ROOM).emit("admin:payment-updated", adminPayload);
}
