# SmartEstate-AI

AI-powered property discovery, trust and bidding platform.

## Run the application locally

Run each service in a separate terminal:

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
