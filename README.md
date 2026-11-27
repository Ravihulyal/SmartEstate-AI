# SmartEstate-AI

AI-powered property discovery, trust and bidding platform.

## Run the application locally

After completing the setup below, run each service in a separate terminal:

```powershell
# Terminal 1 — FastAPI ML service
cd ml-service
.\venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# Terminal 2 — Express API
cd backend
npm run dev

# Terminal 3 — React frontend
cd frontend
npm run dev
```

The backend expects its existing environment configuration and Neon database to be available. The frontend defaults to `http://127.0.0.1:5000/api/v1`; set `VITE_API_BASE_URL` to override it. Keep the frontend browser origin aligned with the backend's `CLIENT_URL` (the checked-in development configuration uses `http://localhost:5173`).

For frontend features, checks, API limitations and production authentication recommendations, see [frontend/README.md](./frontend/README.md).

## Local setup

Use Python 3.11, Node.js/npm, and a Neon PostgreSQL database. The ML model artifacts under `ml-service/artifacts/` are generated files and are not tracked in Git. From PowerShell, prepare the ML service and models once:

```powershell
Set-Location .\ml-service
python -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python training\clean_dataset.py
python training\train_price.py
python training\train_fraud.py
python training\train_risk.py
```

In another terminal, copy `backend/.env.example` to `backend/.env` and privately set `DATABASE_URL`, a strong random `JWT_SECRET`, the local `ML_SERVICE_URL`, and Cloudinary values. Do not commit `.env` files. Then install and run the backend:

```powershell
Set-Location .\backend
npm ci
npm run db:generate
npx prisma migrate deploy
npm run dev
```

The migration command applies the checked-in migrations; it does not reset or delete data. Set `VITE_API_BASE_URL=http://127.0.0.1:5000/api/v1` in `frontend/.env.local` if the frontend needs a non-default API URL, then run `npm ci` and `npm run dev` in `frontend/`. Keep the browser origin (default `http://localhost:5173`) equal to the backend `CLIENT_URL`.

## Cloudinary property image uploads

Add the `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` entries shown in [backend/.env.example](./backend/.env.example) to the existing `backend/.env`, and set the values privately. Do not overwrite the other backend environment settings. Never put Cloudinary credentials in Vite environment variables or commit them. Seller uploads use `POST /api/v1/properties/images` with multipart files named `images`; JPEG, PNG, and WebP are accepted, up to 5 MB each and 6 per property. The authenticated seller's property requests may only include URLs returned from their own Cloudinary upload folder.

## Production deployment checklist

The repository does not include hosting manifests or a CI/CD deployment pipeline. Deploy the three services separately; keep the ML service private and do not deploy publicly without an explicit review.

1. **Provision Neon and Cloudinary.** Create the production database and Cloudinary account. Store credentials in the hosting provider's secret manager, not in Git, build logs, or frontend variables. Use a Neon PostgreSQL connection string with TLS (`sslmode=require`) and least-privilege database access. Provision the initial ADMIN through a controlled operator-only process; public registration only accepts BUYER and SELLER roles.
2. **Deploy the ML service privately.** Use Python 3.11, install `ml-service/requirements.txt`, and ensure the three trusted `*.joblib` files exist in `ml-service/artifacts/` (generate them from the checked-in dataset using the training commands above, or package trusted artifacts). Run `uvicorn app.main:app --host 0.0.0.0 --port $PORT`. Set the backend's `ML_SERVICE_URL` to this service's private address. The FastAPI endpoints do not authenticate callers; restrict network ingress to the backend.
3. **Build and release the backend.** In `backend/`, install dependencies, configure the variables in `backend/.env.example` via the hosting secret store, run `npm run db:generate`, apply existing migrations with `npx prisma migrate deploy`, run `npm run build`, and start with `npm start`. The release/migration environment needs the Prisma CLI development dependency; the long-running API only needs production dependencies and the generated Prisma Client. Verify `GET /api/v1/health`.
4. **Build and host the frontend.** Set `VITE_API_BASE_URL` to the public API origin ending in `/api/v1` before `npm run build`, then host the generated `frontend/dist/` as static files over HTTPS. This Vite variable is public configuration, never a secret.
5. **Configure origin and sockets.** Set `CLIENT_URL` to the exact HTTPS frontend origin. Configure the API reverse proxy to support Socket.IO WebSocket upgrades and keep its path available. Current rate-limit counters and auction status broadcasts are process-local; use one backend instance unless shared rate-limit storage, a Socket.IO adapter, and coordinated scheduling are implemented.
6. **Verify before opening traffic.** Check the frontend, backend health endpoint, ML `/health` endpoint from the backend network, registration/login, image upload, property approval, favorites, and auction bid/socket flows. Do not use real accounts or production records for verification.

### Audit and model limitations

- The frontend stores JWTs in `localStorage`, so an XSS issue can expose a token. The frontend README documents an `HttpOnly`, `Secure`, `SameSite` cookie and CSRF migration as a production hardening task.
- Authentication and ML rate limits use in-process memory. They are not shared across replicas.
- Both full and production-only backend dependency audits report zero vulnerabilities. Prisma 6 CLI's vulnerable `deepmerge-ts` and `effect` transitive versions are pinned to patched versions by tested npm overrides; Prisma remains at 6.19.3. The unused `nodemon` development dependency was removed; the existing `dev` script uses `tsx watch`.
- On the checked-in cleaned dataset (12,041 rows), the saved price model's deterministic 2,409-row holdout has MAE 28.7850 INR lakhs, RMSE 59.1952 lakhs, and R2 0.70915. The risk model's accuracy 0.89249, precision 0.43988, recall 0.68807, and F1 0.53667 compare against heuristic-generated proxy labels, not verified fraud outcomes; its location medians were calculated before the split, so the scores may be optimistic. The anomaly model flagged 123/2,409 (5.106%) holdout rows; there are no ground-truth anomaly labels, so accuracy is unavailable. These metrics are dataset-specific, not production guarantees.
- Recommendations rank the local cleaned dataset using explicit location, budget, bedrooms, and area inputs; they are not personalized from a persisted buyer profile. Anomaly flags indicate unusual patterns only and are not proof of fraud. RENT listings do not receive sale-price predictions.
- `GET /properties`, seller listings, and admin pending listings are currently unpaginated and have no result cap. The audit database had one approved property and no public auctions, so representative gallery/auction fixtures were unavailable in that environment. Add bounded pagination before substantial growth.
- No load test was run, so no scalability or production latency claim is made. The local frontend bundle was 136.32 kB gzip for JavaScript; local UI smoke-checking at 390 px found no horizontal overflow. Auction listing and bid history are capped at 100 records.
