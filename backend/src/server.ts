import dotenv from "dotenv";
dotenv.config();

import { createServer } from "node:http";
import { Server } from "socket.io";
import { createApp } from "./app";
import { initializeAuctionSockets } from "./services/auction-socket.service";
import { startAuctionStatusBroadcasts } from "./services/auction-status.service";
import { startPaymentExpiryWorker } from "./services/payment-expiry.service";

const PORT = process.env.PORT || 5000;
const io = new Server({
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:5173"
  }
});
const app = createApp(io);
const httpServer = createServer(app);

io.attach(httpServer);
initializeAuctionSockets(io);
startAuctionStatusBroadcasts(io);
startPaymentExpiryWorker(io);

httpServer.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});