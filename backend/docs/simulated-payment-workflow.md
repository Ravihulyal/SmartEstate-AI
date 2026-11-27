# Simulated payment and demo closing workflow

This workflow is for demonstration only. It does not contact a payment provider,
move money, or transfer legal title. Every payment response identifies itself as
`SIMULATED` and `isRealPayment: false`.

## State transitions

| Record | Allowed transition | Actor |
| --- | --- | --- |
| Payment | `PENDING` to `SUCCESS` or `FAILED` | Owning winning buyer, through the simulation endpoint |
| Payment | `PENDING` to `EXPIRED` | Expiry worker, buyer status retrieval, or a late simulation attempt |
| Payment | `FAILED` or `EXPIRED` to `PENDING` | Owning winning buyer, through retry; receives a new transaction reference |
| Sale closing | created as `PENDING` after payment succeeds | Server transaction |
| Sale closing | `PENDING` to `COMPLETED` | Owning seller, after server-side eligibility checks |

`SUCCESS` is terminal. A failed, expired, rejected, or cancelled auction cannot
complete a sale closing. A property changes to `SOLD` only in the same transaction
that completes its eligible demo closing.

## API

All endpoints are under `/api/v1/payments` and require a bearer JWT.

| Method and path | Role | Purpose |
| --- | --- | --- |
| `GET /mine/pending` | BUYER | List the authenticated buyer's pending requests |
| `GET /mine/history` | BUYER | Paginated buyer payment history; optional `status`, `page`, `limit` |
| `GET /:id` | BUYER | Read an owned request; expires it first when overdue |
| `POST /:id/simulate` | BUYER | Body `{ "outcome": "SUCCESS" \| "FAILED" }`; the server supplies the amount and reference |
| `POST /:id/retry` | BUYER | Retry a failed or expired request with a new reference; empty body |
| `GET /seller/payments` | SELLER | Paginated payments for the seller's own properties |
| `GET /seller/closings` | SELLER | Paginated closing history for the seller's own properties |
| `POST /seller/closings/:id/confirm` | SELLER | Complete an eligible pending demo closing |
| `GET /admin/all` | ADMIN | Read-only paginated payment monitoring |
| `GET /admin/closings` | ADMIN | Read-only paginated closing monitoring |
| `GET /admin/audit` | ADMIN | Read-only paginated audit history; optional auction/payment/closing filters |

Payment simulation and retry requests are limited to six per minute per client.
List endpoints accept `page` (default 1) and `limit` (default 20, maximum 100).

## Expiry and runtime

`PAYMENT_EXPIRY_HOURS` configures the request lifetime (default `48`; integer
range 1–8760). The backend starts one in-process expiry worker that scans every
30 seconds. This worker is safe against overlapping scans in one process, but
it is not a distributed scheduler: run one backend instance unless an external
distributed scheduler/lease is added. Payment row locks and database constraints
protect concurrent payment and closing transitions.

Prisma migration commands prefer `DIRECT_URL` when configured. For Neon, set
this to the direct, non-pooled connection endpoint; keep `DATABASE_URL` for the
application's runtime connection pool.

## Local demonstration

1. Apply the pending Prisma migration only after the recorded migration-lock
   issue is resolved and the migration SQL has been reviewed.
2. Start the backend and authenticate as a seller. Approve an auction with bids
   using the existing winner-approval endpoint.
3. Use the resulting payment request ID as the winning buyer. Inspect it with
   `GET /api/v1/payments/:id`, then submit either `SUCCESS` or `FAILED` to the
   simulation endpoint. Do not send an amount, buyer ID, status, or transaction
   reference.
4. On `SUCCESS`, verify the sale closing is `PENDING` and the property remains
   unchanged. Authenticate as the owning seller and confirm the closing.
5. Verify the closing is `COMPLETED`, the property status is `SOLD`, and the
   payment and closing audit entries exist. This is only an application demo
   state; no payment or legal title transfer occurred.
