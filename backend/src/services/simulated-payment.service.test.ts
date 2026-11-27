import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import type { Server } from "socket.io";
import prisma from "../config/prisma";
import { PAYMENT_EXPIRY_MS } from "../config/payment.config";
import { completeSaleClosing } from "./sale-closing.service";
import {
  createPaymentRequestForAcceptedAuction,
  expireDuePaymentRequests,
  expirePaymentIfDue,
  PaymentWorkflowError,
  retryPayment,
  simulatePayment,
  type PaymentDetails
} from "./simulated-payment.service";

const NOW = new Date("2026-11-26T12:00:00.000Z");
const AUCTION_ID = "c123456789012345678901234";
const PAYMENT_ID = "c223456789012345678901234";
const CLOSING_ID = "c323456789012345678901234";
const BUYER_ID = "buyer-1";
const SELLER_ID = "seller-1";
const PROPERTY_ID = "property-1";
const BID_ID = "bid-1";

type TestClosing = {
  id: string;
  auctionId: string;
  propertyId: string;
  paymentId: string;
  buyerId: string;
  sellerId: string;
  status: "PENDING" | "COMPLETED";
  createdAt: Date;
  completedAt: Date | null;
  auction: PaymentDetails["auction"];
  property: PaymentDetails["property"];
  payment: PaymentDetails;
};

function makePayment(overrides: Partial<PaymentDetails> = {}): PaymentDetails {
  const payment: PaymentDetails = {
    id: PAYMENT_ID,
    auctionId: AUCTION_ID,
    winningBidId: BID_ID,
    propertyId: PROPERTY_ID,
    buyerId: BUYER_ID,
    sellerId: SELLER_ID,
    amount: new Prisma.Decimal("250000.00"),
    currency: "INR",
    status: "PENDING",
    transactionReference: "SIM-PAY-initial",
    provider: "SIMULATED",
    providerReference: null,
    isSimulated: true,
    createdAt: new Date(NOW.getTime() - 60_000),
    updatedAt: new Date(NOW.getTime() - 60_000),
    paidAt: null,
    expiresAt: new Date(NOW.getTime() + 48 * 60 * 60 * 1000),
    failureReason: null,
    auction: {
      id: AUCTION_ID,
      propertyId: PROPERTY_ID,
      status: "COMPLETED",
      outcomeStatus: "ACCEPTED",
      winningBidId: BID_ID
    },
    property: {
      id: PROPERTY_ID,
      title: "Test home",
      city: "Pune",
      state: "Maharashtra",
      images: [],
      status: "APPROVED",
      sellerId: SELLER_ID
    },
    winningBid: {
      id: BID_ID,
      amount: 250000,
      bidderId: BUYER_ID
    },
    saleClosing: null
  };
  return { ...payment, ...overrides };
}

function makeHarness(initialPayment: PaymentDetails | null = makePayment()) {
  const state = {
    payment: initialPayment,
    closing: null as TestClosing | null,
    propertyStatus: initialPayment?.property.status ?? "APPROVED",
    audits: [] as Array<Record<string, unknown>>,
    events: [] as Array<{ room: string; event: string; payload: Record<string, unknown> }>,
    lockQueries: [] as string[],
    commits: 0,
    propertyUpdates: 0
  };
  let lockTail = Promise.resolve();

  async function acquireLock(): Promise<() => void> {
    const previous = lockTail;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    lockTail = previous.then(() => pending);
    await previous;
    return release;
  }

  const transaction = {
    $queryRaw: async (strings: TemplateStringsArray) => {
      const query = strings.join(" ");
      state.lockQueries.push(query);
      const release = await acquireLock();
      releases.push(release);
      if (query.includes('"SaleClosing"')) {
        return state.closing ? [{ id: state.closing.id }] : [];
      }
      return state.payment ? [{ id: state.payment.id }] : [];
    },
    payment: {
      findFirst: async ({ where }: { where: Record<string, string> }) => {
        const payment = state.payment;
        if (!payment) return null;
        if (where.auctionId && payment.auctionId !== where.auctionId) return null;
        if (where.id && payment.id !== where.id) return null;
        if (where.buyerId && payment.buyerId !== where.buyerId) return null;
        return { id: payment.id };
      },
      findUnique: async () => state.payment,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (state.payment) throw new Error("duplicate payment fixture");
        const created = makePayment({
          ...data,
          id: PAYMENT_ID,
          status: "PENDING",
          createdAt: NOW,
          updatedAt: NOW,
          auction: makePayment().auction,
          property: makePayment().property,
          winningBid: makePayment().winningBid,
          saleClosing: null
        } as unknown as Partial<PaymentDetails>);
        state.payment = created;
        return created;
      },
      update: async ({ data }: { data: Partial<PaymentDetails> }) => {
        assert.ok(state.payment);
        state.payment = {
          ...state.payment,
          ...data,
          updatedAt: NOW,
          property: { ...state.payment.property, status: state.propertyStatus },
          saleClosing: state.closing
            ? {
                id: state.closing.id,
                status: state.closing.status,
                createdAt: state.closing.createdAt,
                completedAt: state.closing.completedAt
              }
            : null
        };
        if (state.closing) state.closing.payment = state.payment;
        return state.payment;
      }
    },
    saleClosing: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.closing = {
          id: CLOSING_ID,
          auctionId: String(data.auctionId),
          propertyId: String(data.propertyId),
          paymentId: String(data.paymentId),
          buyerId: String(data.buyerId),
          sellerId: String(data.sellerId),
          status: "PENDING",
          createdAt: NOW,
          completedAt: null,
          auction: makePayment().auction,
          property: {
            ...makePayment().property,
            status: state.propertyStatus
          },
          payment: state.payment!
        };
        return { id: CLOSING_ID, status: "PENDING" };
      },
      findUnique: async () => state.closing,
      update: async ({ data }: { data: { status: "COMPLETED"; completedAt: Date } }) => {
        assert.ok(state.closing);
        state.closing = {
          ...state.closing,
          status: data.status,
          completedAt: data.completedAt,
          property: { ...state.closing.property, status: state.propertyStatus },
          payment: state.payment!
        };
        return state.closing;
      }
    },
    property: {
      updateMany: async ({ where, data }: {
        where: { id: string; sellerId: string; status: string };
        data: { status: "SOLD" };
      }) => {
        if (
          where.id !== PROPERTY_ID
          || where.sellerId !== SELLER_ID
          || state.propertyStatus !== where.status
        ) {
          return { count: 0 };
        }
        state.propertyStatus = data.status;
        state.propertyUpdates += 1;
        if (state.closing) {
          state.closing.property = { ...state.closing.property, status: "SOLD" };
        }
        return { count: 1 };
      }
    },
    auctionAuditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const record = { ...data, id: `audit-${state.audits.length + 1}`, createdAt: NOW };
        state.audits.push(record);
        return record;
      }
    }
  };
  const releases: Array<() => void> = [];
  const database = {
    ...transaction,
    payment: {
      ...transaction.payment,
      findMany: async ({ where }: { where?: Record<string, unknown> } = {}) => {
        const payment = state.payment;
        if (!payment) return [];
        if (where?.status && payment.status !== where.status) return [];
        if (typeof where?.buyerId === "string" && payment.buyerId !== where.buyerId) return [];
        if (typeof where?.sellerId === "string" && payment.sellerId !== where.sellerId) return [];
        return [{ id: payment.id }];
      }
    },
    $transaction: async <T>(operation: (tx: unknown) => Promise<T>): Promise<T> => {
      const startingReleases = releases.length;
      try {
        const result = await operation(transaction);
        state.commits += 1;
        return result;
      } finally {
        while (releases.length > startingReleases) releases.pop()?.();
      }
    }
  } as unknown as typeof prisma;

  const io = {
    to: (room: string) => ({
      emit: (event: string, payload: Record<string, unknown>) => {
        assert.ok(state.commits > 0, "Socket events must be emitted after commit");
        state.events.push({ room, event, payload });
      }
    })
  } as unknown as Server;

  return { state, database, transaction, io };
}

function assertWorkflowError(error: unknown, statusCode: number) {
  assert.ok(error instanceof PaymentWorkflowError);
  assert.equal(error.statusCode, statusCode);
}

describe("simulated payment lifecycle", () => {
  it("creates a single INR payment request from the accepted winning bid", async () => {
    const harness = makeHarness(null);
    const payment = await createPaymentRequestForAcceptedAuction(
      harness.transaction as never,
      {
        auctionId: AUCTION_ID,
        propertyId: PROPERTY_ID,
        winningBidId: BID_ID,
        buyerId: BUYER_ID,
        sellerId: SELLER_ID,
        amount: 250000,
        now: NOW
      }
    );

    assert.equal(payment.status, "PENDING");
    assert.equal(payment.amount.toFixed(2), "250000.00");
    assert.equal(payment.currency, "INR");
    assert.equal(payment.provider, "SIMULATED");
    assert.equal(payment.isSimulated, true);
    assert.match(payment.transactionReference, /^SIM-PAY-/);
    assert.equal(payment.expiresAt?.getTime(), NOW.getTime() + PAYMENT_EXPIRY_MS);
    assert.equal(harness.state.audits[0].action, "PAYMENT_CREATED");
    assert.equal(harness.state.audits[0].buyerId, BUYER_ID);
  });

  it("does not create another payment request for the same auction", async () => {
    const harness = makeHarness();
    await assert.rejects(
      createPaymentRequestForAcceptedAuction(harness.transaction as never, {
        auctionId: AUCTION_ID,
        propertyId: PROPERTY_ID,
        winningBidId: BID_ID,
        buyerId: BUYER_ID,
        sellerId: SELLER_ID,
        amount: 250000,
        now: NOW
      }),
      (error: unknown) => {
        assertWorkflowError(error, 409);
        return true;
      }
    );
  });

  it("succeeds only for the winning buyer and creates one pending sale closing", async () => {
    const harness = makeHarness();
    const result = await simulatePayment(harness.io, harness.database, {
      paymentId: PAYMENT_ID,
      buyerId: BUYER_ID,
      outcome: "SUCCESS",
      now: NOW
    });

    assert.equal(result.kind, "SUCCESS");
    assert.equal(result.payment.status, "SUCCESS");
    assert.equal(result.payment.paidAt?.getTime(), NOW.getTime());
    assert.deepEqual(result.saleClosing, { id: CLOSING_ID, status: "PENDING" });
    assert.deepEqual(harness.state.audits.map(({ action }) => action), [
      "PAYMENT_INITIATED",
      "PAYMENT_SUCCEEDED",
      "SALE_CLOSING_CREATED"
    ]);
    assert.ok(harness.state.events.some(({ event }) => event === "payment:succeeded"));
    assert.ok(harness.state.events.some(({ event }) => event === "sale-closing:pending"));
    assert.ok(harness.state.events.every(({ room }) => !room.startsWith("auction:")));
    assert.ok(harness.state.events.every(({ payload }) => payload.isRealPayment === false));
  });

  it("records simulated failure without creating a closing", async () => {
    const harness = makeHarness();
    const result = await simulatePayment(harness.io, harness.database, {
      paymentId: PAYMENT_ID,
      buyerId: BUYER_ID,
      outcome: "FAILED",
      now: NOW
    });

    assert.equal(result.kind, "FAILED");
    assert.equal(result.payment.status, "FAILED");
    assert.equal(result.saleClosing, null);
    assert.equal(harness.state.closing, null);
    assert.equal(harness.state.audits[harness.state.audits.length - 1]?.action, "PAYMENT_FAILED");
    assert.ok(harness.state.events.some(({ event }) => event === "payment:failed"));
  });

  it("hides another buyer's payment and rejects a mismatched accepted bid", async () => {
    const wrongOwner = makeHarness();
    await assert.rejects(
      simulatePayment(wrongOwner.io, wrongOwner.database, {
        paymentId: PAYMENT_ID,
        buyerId: "buyer-other",
        outcome: "SUCCESS",
        now: NOW
      }),
      (error: unknown) => {
        assertWorkflowError(error, 404);
        return true;
      }
    );

    const wrongAuction = makeHarness(makePayment({
      auction: {
        ...makePayment().auction,
        outcomeStatus: "REJECTED"
      }
    }));
    await assert.rejects(
      simulatePayment(wrongAuction.io, wrongAuction.database, {
        paymentId: PAYMENT_ID,
        buyerId: BUYER_ID,
        outcome: "SUCCESS",
        now: NOW
      }),
      (error: unknown) => {
        assertWorkflowError(error, 409);
        return true;
      }
    );
    assert.equal(wrongAuction.state.payment?.status, "PENDING");
    assert.equal(wrongAuction.state.closing, null);
  });

  it("expires a due request instead of accepting a simulated success", async () => {
    const harness = makeHarness(makePayment({
      expiresAt: new Date(NOW.getTime() - 1)
    }));
    const result = await simulatePayment(harness.io, harness.database, {
      paymentId: PAYMENT_ID,
      buyerId: BUYER_ID,
      outcome: "SUCCESS",
      now: NOW
    });

    assert.equal(result.kind, "EXPIRED");
    assert.equal(result.payment.status, "EXPIRED");
    assert.equal(harness.state.closing, null);
    assert.ok(harness.state.audits.some(({ action }) => action === "PAYMENT_EXPIRED"));
    assert.ok(harness.state.events.some(({ event }) => event === "payment:expired"));
    assert.ok(!harness.state.events.some(({ event }) => event === "payment:succeeded"));
    assert.ok(!harness.state.events.some(({ event }) => event === "payment:initiated"));
  });

  it("expires due payment requests through the scheduled scan", async () => {
    const harness = makeHarness(makePayment({
      expiresAt: new Date(NOW.getTime() - 1)
    }));
    const expiredCount = await expireDuePaymentRequests(
      harness.io,
      harness.database,
      {},
      NOW
    );

    assert.equal(expiredCount, 1);
    assert.equal(harness.state.payment?.status, "EXPIRED");
    assert.equal(harness.state.audits.filter(({ action }) => action === "PAYMENT_EXPIRED").length, 1);
    assert.ok(harness.state.events.some(({ event }) => event === "payment:expired"));
  });

  it("retries failed attempts with a new reference and retains the prior reference in audit", async () => {
    const harness = makeHarness();
    await simulatePayment(harness.io, harness.database, {
      paymentId: PAYMENT_ID,
      buyerId: BUYER_ID,
      outcome: "FAILED",
      now: NOW
    });
    const previousReference = harness.state.payment!.transactionReference;
    const retried = await retryPayment(harness.io, harness.database, {
      paymentId: PAYMENT_ID,
      buyerId: BUYER_ID,
      now: NOW
    });

    assert.equal(retried.status, "PENDING");
    assert.notEqual(retried.transactionReference, previousReference);
    assert.match(retried.transactionReference, /^SIM-PAY-/);
    assert.equal(retried.expiresAt?.getTime(), NOW.getTime() + PAYMENT_EXPIRY_MS);
    const retryAudit = harness.state.audits.find(({ action }) => action === "PAYMENT_RETRY_INITIATED");
    assert.ok(String(retryAudit?.reason).includes(previousReference));
    assert.ok(String(retryAudit?.reason).includes(retried.transactionReference));
  });

  it("rejects duplicate successful attempts and concurrent duplicate successes", async () => {
    const harness = makeHarness();
    const attempts = await Promise.allSettled([
      simulatePayment(harness.io, harness.database, {
        paymentId: PAYMENT_ID,
        buyerId: BUYER_ID,
        outcome: "SUCCESS",
        now: NOW
      }),
      simulatePayment(harness.io, harness.database, {
        paymentId: PAYMENT_ID,
        buyerId: BUYER_ID,
        outcome: "SUCCESS",
        now: NOW
      })
    ]);

    assert.equal(attempts.filter(({ status }) => status === "fulfilled").length, 1);
    const rejected = attempts.find(({ status }) => status === "rejected");
    assert.ok(rejected && rejected.status === "rejected");
    assertWorkflowError(rejected.reason, 409);
    assert.equal(harness.state.payment?.status, "SUCCESS");
    assert.equal(harness.state.closing?.status, "PENDING");
    assert.equal(harness.state.audits.filter(({ action }) => action === "SALE_CLOSING_CREATED").length, 1);
  });

  it("serializes concurrent expiry and payment attempts without a success after expiry", async () => {
    const expiredAt = new Date(NOW.getTime() - 1);
    const harness = makeHarness(makePayment({ expiresAt: expiredAt }));
    const outcomes = await Promise.allSettled([
      simulatePayment(harness.io, harness.database, {
        paymentId: PAYMENT_ID,
        buyerId: BUYER_ID,
        outcome: "SUCCESS",
        now: NOW
      }),
      expirePaymentIfDue(harness.io, harness.database, PAYMENT_ID, NOW)
    ]);

    assert.ok(outcomes.some(({ status }) => status === "fulfilled"));
    assert.equal(harness.state.payment?.status, "EXPIRED");
    assert.equal(harness.state.closing, null);
    assert.equal(harness.state.audits.filter(({ action }) => action === "PAYMENT_SUCCEEDED").length, 0);
    assert.equal(harness.state.audits.filter(({ action }) => action === "PAYMENT_EXPIRED").length, 1);
  });
});

describe("seller sale closing", () => {
  it("marks the property SOLD only after the seller confirms a successful simulated payment", async () => {
    const harness = makeHarness();
    await simulatePayment(harness.io, harness.database, {
      paymentId: PAYMENT_ID,
      buyerId: BUYER_ID,
      outcome: "SUCCESS",
      now: NOW
    });
    const closing = await completeSaleClosing(harness.io, harness.database, {
      closingId: CLOSING_ID,
      sellerId: SELLER_ID,
      now: new Date(NOW.getTime() + 1)
    });

    assert.equal(closing.status, "COMPLETED");
    assert.equal(closing.completedAt?.getTime(), NOW.getTime() + 1);
    assert.equal(harness.state.propertyStatus, "SOLD");
    assert.equal(harness.state.propertyUpdates, 1);
    assert.ok(harness.state.audits.some(({ action }) => action === "SALE_CLOSING_COMPLETED"));
    assert.ok(harness.state.events.some(({ event }) => event === "sale-closing:completed"));
  });

  it("rejects another seller, an unconfirmed buyer, or a seller with an unsuccessful payment", async () => {
    const harness = makeHarness(makePayment({ status: "FAILED" }));
    harness.state.closing = {
      id: CLOSING_ID,
      auctionId: AUCTION_ID,
      propertyId: PROPERTY_ID,
      paymentId: PAYMENT_ID,
      buyerId: BUYER_ID,
      sellerId: SELLER_ID,
      status: "PENDING",
      createdAt: NOW,
      completedAt: null,
      auction: makePayment().auction,
      property: makePayment().property,
      payment: harness.state.payment!
    };

    await assert.rejects(
      completeSaleClosing(harness.io, harness.database, {
        closingId: CLOSING_ID,
        sellerId: "seller-other",
        now: NOW
      }),
      (error: unknown) => {
        assertWorkflowError(error, 403);
        return true;
      }
    );
    await assert.rejects(
      completeSaleClosing(harness.io, harness.database, {
        closingId: CLOSING_ID,
        sellerId: BUYER_ID,
        now: NOW
      }),
      (error: unknown) => {
        assertWorkflowError(error, 403);
        return true;
      }
    );
    await assert.rejects(
      completeSaleClosing(harness.io, harness.database, {
        closingId: CLOSING_ID,
        sellerId: SELLER_ID,
        now: NOW
      }),
      (error: unknown) => {
        assertWorkflowError(error, 409);
        return true;
      }
    );
    assert.equal(harness.state.propertyStatus, "APPROVED");
    assert.equal(harness.state.propertyUpdates, 0);
  });

  it("allows only one concurrent closing confirmation", async () => {
    const harness = makeHarness();
    await simulatePayment(harness.io, harness.database, {
      paymentId: PAYMENT_ID,
      buyerId: BUYER_ID,
      outcome: "SUCCESS",
      now: NOW
    });
    const attempts = await Promise.allSettled([
      completeSaleClosing(harness.io, harness.database, {
        closingId: CLOSING_ID,
        sellerId: SELLER_ID,
        now: NOW
      }),
      completeSaleClosing(harness.io, harness.database, {
        closingId: CLOSING_ID,
        sellerId: SELLER_ID,
        now: NOW
      })
    ]);

    assert.equal(attempts.filter(({ status }) => status === "fulfilled").length, 1);
    assert.equal(harness.state.propertyStatus, "SOLD");
    assert.equal(harness.state.propertyUpdates, 1);
    assert.equal(harness.state.audits.filter(({ action }) => action === "SALE_CLOSING_COMPLETED").length, 1);
  });

  it("does not complete a closing twice", async () => {
    const harness = makeHarness();
    await simulatePayment(harness.io, harness.database, {
      paymentId: PAYMENT_ID,
      buyerId: BUYER_ID,
      outcome: "SUCCESS",
      now: NOW
    });
    await completeSaleClosing(harness.io, harness.database, {
      closingId: CLOSING_ID,
      sellerId: SELLER_ID,
      now: NOW
    });
    await assert.rejects(
      completeSaleClosing(harness.io, harness.database, {
        closingId: CLOSING_ID,
        sellerId: SELLER_ID,
        now: NOW
      }),
      (error: unknown) => {
        assertWorkflowError(error, 409);
        return true;
      }
    );
    assert.equal(harness.state.propertyUpdates, 1);
  });
});
