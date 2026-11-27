# SmartEstate AI frontend

React, TypeScript, Vite, Tailwind CSS and Lucide-based interface for the SmartEstate Express API.

## Run locally

Start the backend from `backend/` with `npm run dev`, then start the frontend:

```powershell
cd frontend
npm install
npm run dev
```

By default, the frontend calls `http://127.0.0.1:5000/api/v1`. Override it with `VITE_API_BASE_URL` when the backend runs elsewhere. The backend's configured `CLIENT_URL` must match the browser origin (the default backend configuration uses `http://localhost:5173`).

Run checks with `npm run build` and `npm run lint`.

## Integrated features

- Buyer and seller registration, login and current-user lookup.
- Role-protected buyer, seller and administrator dashboards.
- Approved-property search by city, listing type, property type and bedroom count.
- Property details, backend-persisted buyer favorites and sale estimate display in lakhs.
- Seller property creation, owned listings, eligible edits and approval status.
- Auction discovery, seller auction creation, buyer bidding, bid history and live Socket.IO updates.
- Administrator pending review, approval and rejection.
- Buyer simulated-payment requests, attempt history and simulated receipts; seller payment monitoring and confirmation of eligible demo closings; administrator read-only payment, closing and audit monitoring.

The payment workflow is a hackathon demonstration only. It collects no payment credentials, does not contact a payment provider, and does not transfer legal property title. Buyer outcomes are explicitly simulated; only the backend can authorize a seller closing, and admins have read-only transaction access.

The seller flow requests a Random Forest estimate only for SALE properties; RENT properties have no sale-price estimate. The backend also exposes anomaly-detection, risk-classification and recommendation endpoints, but they are not buyer-dashboard workflows. Recommendations rank candidates from explicit search attributes and the local dataset, not a persisted personal profile. Anomaly flags are review signals, not proof of fraud; risk-model labels are heuristic demonstrations, not verified fraud outcomes.

Favorites are stored by the backend for authenticated buyers. Auction reads are available at `GET /api/v1/auctions`, `GET /api/v1/auctions/:id` and `GET /api/v1/auctions/:id/bids`; sellers create auctions with `POST /api/v1/auctions`, and buyers bid with `POST /api/v1/auctions/:id/bids`. Socket.IO connections use the existing JWT and can join approved auction rooms for live bid and status updates. A first bid may equal the starting price; each later bid must exceed the current highest bid by at least INR 0.01. The existing model has no configurable increment or auction cancellation endpoint. Auction listing and bid-history responses are capped at 100 items. The admin overview reports pending and public approved listing counts; it does not invent a user count because the current backend has no user-directory endpoint. Seller contact details and viewing/booking flows are likewise not available from the current API.

## Authentication and production security

This development frontend stores the JWT in `localStorage` and attaches it as a bearer token. This matches the existing Express API, but JavaScript-readable storage can be stolen by cross-site scripting. Before production:

1. Prefer server-issued `HttpOnly`, `Secure`, `SameSite` cookies and add CSRF protection; this requires coordinated backend changes.
2. Serve the app and API only over HTTPS, and configure a restrictive Content Security Policy and other security headers.
3. Keep short access-token lifetimes, add refresh-token rotation/revocation, and ensure role changes invalidate existing credentials.
4. Review the backend's registration/admin provisioning, rate limits, logging, and input validation before exposing it publicly.

Passwords are sent only to the backend over the API and are never persisted by the frontend.
