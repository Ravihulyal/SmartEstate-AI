import assert from "node:assert/strict";
import { describe, it } from "node:test";
import jwt from "jsonwebtoken";
import type { Server, Socket } from "socket.io";
import { JWT_SECRET } from "../config/env";
import { ADMIN_PAYMENT_MONITOR_ROOM, initializeAuctionSockets } from "./auction-socket.service";

describe("auction socket authorization", () => {
  it("rejects clients that do not present a valid JWT", () => {
    let middleware: ((socket: Socket, next: (error?: Error) => void) => void) | undefined;
    const io = {
      use: (handler: unknown) => { middleware = handler as typeof middleware },
      on: () => undefined
    } as unknown as Server;
    initializeAuctionSockets(io);

    let connectionError: Error | undefined;
    const socket = {
      handshake: { auth: {}, headers: {} },
      data: {}
    } as unknown as Socket;
    middleware?.(socket, (error) => { connectionError = error });

    assert.equal(connectionError?.message, "Authentication required");
  });

  it("places authenticated sockets in their private user room without a client join event", () => {
    let middleware: ((socket: Socket, next: (error?: Error) => void) => void) | undefined;
    let connect: ((socket: Socket) => void) | undefined;
    const io = {
      use: (handler: unknown) => { middleware = handler as typeof middleware },
      on: (event: string, handler: unknown) => {
        if (event === "connection") connect = handler as typeof connect;
      }
    } as unknown as Server;
    initializeAuctionSockets(io);

    const token = jwt.sign(
      { role: "BUYER" },
      JWT_SECRET,
      { subject: "buyer-private", expiresIn: "5m" }
    );
    const joined: string[] = [];
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const socket = {
      handshake: { auth: { token }, headers: {} },
      data: {},
      join: async (room: string) => { joined.push(room) },
      on: (event: string, handler: (...args: unknown[]) => void) => { handlers.set(event, handler) },
      emit: () => undefined,
      leave: async () => undefined
    } as unknown as Socket;

    let connectionError: Error | undefined;
    middleware?.(socket, (error) => { connectionError = error });
    assert.equal(connectionError, undefined);
    connect?.(socket);
    assert.deepEqual(joined, ["user:buyer-private"]);
    assert.equal(handlers.has("auction:join"), true);
    assert.equal(handlers.has("user:join"), false);
  });

  it("joins only authenticated administrators to the private payment monitoring room", () => {
    let middleware: ((socket: Socket, next: (error?: Error) => void) => void) | undefined;
    let connect: ((socket: Socket) => void) | undefined;
    const io = {
      use: (handler: unknown) => { middleware = handler as typeof middleware },
      on: (event: string, handler: unknown) => {
        if (event === "connection") connect = handler as typeof connect;
      }
    } as unknown as Server;
    initializeAuctionSockets(io);

    for (const role of ["BUYER", "ADMIN"] as const) {
      const token = jwt.sign(
        { role },
        JWT_SECRET,
        { subject: `${role.toLowerCase()}-socket`, expiresIn: "5m" }
      );
      const joined: string[] = [];
      const socket = {
        handshake: { auth: { token }, headers: {} },
        data: {},
        join: async (room: string) => { joined.push(room) },
        on: () => undefined,
        emit: () => undefined,
        leave: async () => undefined
      } as unknown as Socket;

      middleware?.(socket, () => undefined);
      connect?.(socket);
      assert.deepEqual(
        joined,
        role === "ADMIN"
          ? [`user:${role.toLowerCase()}-socket`, ADMIN_PAYMENT_MONITOR_ROOM]
          : [`user:${role.toLowerCase()}-socket`]
      );
    }
  });
});
