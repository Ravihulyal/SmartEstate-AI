import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Server } from "socket.io";
import { ADMIN_PAYMENT_MONITOR_ROOM } from "./auction-socket.service";
import { broadcastPaymentEvent } from "./payment-socket.service";

describe("private payment socket notifications", () => {
  it("sends payment details only to the involved users and admin monitoring room", () => {
    const emitted: Array<{ room: string; event: string; payload: Record<string, unknown> }> = [];
    const io = {
      to: (room: string) => ({
        emit: (event: string, payload: Record<string, unknown>) => {
          emitted.push({ room, event, payload });
        }
      })
    } as unknown as Server;

    broadcastPaymentEvent(
      io,
      "payment:succeeded",
      { buyerId: "buyer-private", sellerId: "seller-private" },
      {
        paymentId: "payment-1",
        transactionReference: "SIM-PAY-private",
        isRealPayment: false
      },
      {
        paymentId: "payment-1",
        transactionReference: "SIM-PAY-private",
        isRealPayment: false
      }
    );

    assert.deepEqual(emitted.map(({ room }) => room), [
      "user:buyer-private",
      "user:seller-private",
      ADMIN_PAYMENT_MONITOR_ROOM
    ]);
    assert.ok(emitted.every(({ room }) => !room.startsWith("auction:")));
    assert.ok(emitted.every(({ payload }) =>
      !("buyerId" in payload) && !("sellerId" in payload)
    ));
    assert.equal(emitted[0].payload.transactionReference, "SIM-PAY-private");
  });
});
