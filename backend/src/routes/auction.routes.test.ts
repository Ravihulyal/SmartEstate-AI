import assert from "node:assert/strict";
import { once } from "node:events";
import { after, before, describe, it } from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import type { Server } from "socket.io";
import type prismaClient from "../config/prisma";
import { JWT_SECRET } from "../config/env";
import { createAuctionRouter } from "./auction.routes";

const AUCTION_ID = "c123456789012345678901234";

describe("auction route authorization", () => {
  const app = express();
  const io = { to: () => ({ emit: () => true }) } as unknown as Server;
  app.use(express.json());
  app.use("/api/v1/auctions", createAuctionRouter(io, {} as typeof prismaClient));
  const server = app.listen(0, "127.0.0.1");

  before(async () => {
    await once(server, "listening");
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  it("requires authentication and reserves early ending to administrators", async () => {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const endpoint = `http://127.0.0.1:${address.port}/api/v1/auctions/${AUCTION_ID}/end-early`;

    const anonymous = await fetch(endpoint, { method: "POST" });
    assert.equal(anonymous.status, 401);

    const sellerToken = jwt.sign(
      { role: "SELLER" },
      JWT_SECRET,
      { subject: "seller-1", expiresIn: "5m" }
    );
    const seller = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sellerToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ reason: "Seller must not end early" })
    });
    assert.equal(seller.status, 403);
  });

  it("keeps administrative auction history unavailable to sellers", async () => {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const sellerToken = jwt.sign(
      { role: "SELLER" },
      JWT_SECRET,
      { subject: "seller-1", expiresIn: "5m" }
    );
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/auctions/admin/all`, {
      headers: { Authorization: `Bearer ${sellerToken}` }
    });
    assert.equal(response.status, 403);
  });

  it("reserves winner decisions for sellers and blocks buyers and admins", async () => {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const endpoint = `http://127.0.0.1:${address.port}/api/v1/auctions/${AUCTION_ID}`;
    const buyerToken = jwt.sign(
      { role: "BUYER" },
      JWT_SECRET,
      { subject: "buyer-1", expiresIn: "5m" }
    );
    const adminToken = jwt.sign(
      { role: "ADMIN" },
      JWT_SECRET,
      { subject: "admin-1", expiresIn: "5m" }
    );

    for (const token of [buyerToken, adminToken]) {
      for (const action of ["approve-winner", "reject-winner"]) {
        const response = await fetch(`${endpoint}/${action}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ reason: "Decision reason" })
        });
        assert.equal(response.status, 403);
      }
    }

    const adminPendingApprovals = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/auctions/seller/pending-approval`,
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );
    assert.equal(adminPendingApprovals.status, 403);
  });
});
