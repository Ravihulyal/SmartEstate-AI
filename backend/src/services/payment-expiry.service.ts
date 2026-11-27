import type { Server } from "socket.io";
import prisma from "../config/prisma";
import {
  expireDuePaymentRequests,
  type PaymentDatabase
} from "./simulated-payment.service";

const PAYMENT_EXPIRY_SCAN_INTERVAL_MS = 30_000;

export function startPaymentExpiryWorker(
  io: Server,
  database: PaymentDatabase = prisma
): () => void {
  let stopped = false;
  let scanInProgress = false;

  const scan = async () => {
    if (stopped || scanInProgress) return;
    scanInProgress = true;
    try {
      await expireDuePaymentRequests(io, database);
    } catch {
      console.error("Payment expiry scan failed");
    } finally {
      scanInProgress = false;
    }
  };

  void scan();
  const interval = setInterval(() => void scan(), PAYMENT_EXPIRY_SCAN_INTERVAL_MS);
  return () => {
    stopped = true;
    clearInterval(interval);
  };
}
