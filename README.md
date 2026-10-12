# YHealth Food Agent
Clarify-then-calculate food logging agent. Flow: text/voice → `/api/clarify` (batched questions) → answers → `/api/calculate` (LLM + optional web search supplies per-100 g data; deterministic code computes GL, diabetes score, colour, meal summary) → JSON.

## Run
    cp .env.example .env   # set GEMINI_API_KEY, ACCESS_CODE
    npm install && npm start      # http://localhost:3000
    docker build -t yhealth-food-agent . && docker run -p 3000:3000 --env-file .env -v yh-data:/data yhealth-food-agent
Deploy on Render/Railway/Fly/Cloud Run: use the Dockerfile, set env vars, mount a persistent volume at `/data`.

## Behaviour
- Cache: in-memory, 24 h, normalised keys. DB: `data/foods.json`. New LLM entries are `verified:false` and queued in `verification_queue.json`; `GET /api/admin/queue`, `POST /api/admin/verify {key}` (header `x-access-code` = ADMIN_CODE). Verified records are never overwritten by unverified ones.
- Meal colour = worst item, escalated by total GL (>20 → at least Yellow, >30 → Red). Flags: alcohol, sodium, large meal.
- `npm test` runs with a mock LLM (no key needed). Without `GEMINI_API_KEY` the app runs in demo mode.
- Not a medical device; verify entries clinically before use in care decisions. For multi-instance scale, swap TTLCache for Redis and JsonStore for Postgres.
