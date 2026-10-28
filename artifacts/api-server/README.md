# API Server and MongoDB Atlas

## Configure Atlas

1. Create a MongoDB Atlas cluster. Atlas clusters provide replica-set support required by the atomic bid transaction.
2. Create a database user with read/write access to the application database.
3. Add the development machine's IP address under **Network Access**. Avoid opening access to every IP for production.
4. Copy the connection string from **Connect > Drivers**. URL-encode special characters in the database username or password.

## Configure environment

From the repository root, copy `.env.example` to `.env` and set `MONGODB_URI` to the Atlas connection string. Keep `.env` private; it is ignored by Git. `MONGODB_DB_NAME` defaults to `bidding_platform` if omitted. Set `SESSION_SECRET` to a long random value before starting the API.

The server connects to MongoDB before listening. It creates indexes for user email, auction listing, bids, notifications, transactions, activity, and watchlists. It does not seed demo data. `GET /api/healthz` pings MongoDB and returns `503` with `{"status":"degraded"}` while storage is unavailable.

## Run

From the repository root:

```powershell
$env:TEMP = 'D:\bidding-platform-cache\tmp'
$env:TMP = $env:TEMP
$env:NODE_PATH = 'D:\bidding-platform-cache\native\node_modules'
corepack pnpm --filter @workspace/api-server build
$env:PORT = '3001'
corepack pnpm --filter @workspace/api-server start
```

The frontend's Vite proxy targets `http://localhost:3001` by default. Set `API_PROXY_TARGET` if the API runs elsewhere.

## Account roles and administration

- Every buyer or seller account can both bid on auctions and create listings; the selected profile only determines the account's initial presentation.
- Buyers and sellers can browse auctions, place bids, save lots, create listings, and review their own bids, wins, listings, and completed sales.
- Auction listings accept an HTTP(S) image URL or an uploaded PNG, JPEG, WebP, or GIF image up to 3.5 MB. Uploaded image bytes are stored with the auction record in MongoDB.
- Administrators can review platform metrics, users, auctions, bids, and transactions. They can suspend or restore buyer/seller accounts and cancel active listings; completed auction and bid records remain available for audit. Administrative accounts retain moderation capabilities and are not treated as buyer/seller accounts.

Suspended accounts cannot sign in or use an existing session. Administrator accounts cannot be suspended through the moderation endpoint. Administrative routes require a valid administrator session.

## Collections

- `users`: account identity, role, password hash, and activity timestamps.
- `auctions`: listing, schedule, status, pricing, and winner fields.
- `bids`: accepted and rejected bid history with processing timings.
- `notifications`: per-user auction and bid notifications.
- `transactions`: completed-auction transaction records.
- `activities`: recent platform activity.
- `userActivity`: timestamps used to calculate active accounts.
- `watchlists`: one document per account containing saved auction IDs.
- `requestSamples`: request performance samples.

Buyers can place bids before the seller's scheduled opening time. Bidding remains open until the seller's scheduled closing time; bids never extend or reset that deadline. At closing, the highest bid from a buyer who has not exited wins, including when there was only one bidder. The API checks scheduled auction transitions and records the winner when the fixed closing time arrives. Bid writes use a MongoDB transaction guarded by the previously observed price; if another bidder wins the race, the request returns `409 BID_OUTDATED` with the latest minimum bid. MongoDB transactions require Atlas or another replica-set deployment.

Accepted bids, exits, and scheduled auction state changes are broadcast over Socket.IO so connected auction lists, dashboards, and bid histories refresh without manual reloads.

## Software metrics

Administrators can open **Software Metrics** in the navigation or call `GET /api/admin/metrics/{overview|standard|custom|trends}` with `range=1h`, `24h`, `7d`, `30d`, or `all`. The page refreshes every five seconds. Metric windows use UTC timestamps with an inclusive start and a current-time end. Bid attempts and API latency use persisted completed request samples; accepted/rejected bid audit values use persisted bid records; auction and transaction values use persisted records. A metric without a real denominator or sufficient audit history is returned as `null` with `INSUFFICIENT_DATA`, not a fabricated zero.

Every completed POST/PUT/PATCH/DELETE to a bid endpoint is counted once as a bid attempt; 2xx responses are accepted and all other responses are rejected. Meaningful authenticated write actions are persisted as user activity. Bid validation audit data is recorded for new accepted and rejected bid records; bid records without that audit are excluded from AFS calculations. BES calculates user participation as distinct active bidders divided by registered, non-admin, non-suspended users; accepted bid volume is normalized to 20 bids per auction, and time-based participation uses occupied eligible auction-hour/day bins. AFS reports valid-bid compliance and timing compliance against all audited attempts, and rejection accuracy as correct acceptances plus correct rejections divided by all audited attempts. New finalized auctions record their actual finalization timestamp; older records fall back to scheduled close time and disclose the fallback count. A transaction is eligible for the completion-rate denominator after its recorded seven-day deadline; legacy transactions without a deadline use their creation time plus seven days. The current transaction model has no status-change workflow, so completion reflects the persisted status at calculation time. Source collections use the existing application storage model and are loaded into memory on startup.

Run metric formula and edge-case tests with `corepack pnpm --filter @workspace/api-server test`.

To display synthetic metric values without writing demo records to MongoDB, run the API in development with `METRICS_DEMO_MODE=true`. In PowerShell, from the repository root, set `$env:NODE_ENV='development'` and `$env:METRICS_DEMO_MODE='true'` before starting the API. The sample auctions, bids, users, transactions, activity, and request timings exist only in the API process memory and disappear when it stops. Open **Software Metrics** as an administrator and select **All Time** to include the full sample, including the older transactions whose seven-day deadlines have passed. Demo records are labeled and excluded from MongoDB state persistence.

Buyers and sellers who have placed an accepted bid can exit while they are not currently leading. The current leader cannot exit. Exiting removes that bidder from winner eligibility until they place another accepted bid. Once at least two distinct buyers have bid, an exit that leaves exactly one active bidder closes the auction immediately and awards it to that bidder. The exiting bidder can rejoin by bidding again before the scheduled closing time.

To remove the known demo auctions and their related bid, transaction, notification, activity, user-activity, and watchlist records from MongoDB Atlas, run this from the API-server directory after configuring `.env`:

```powershell
node .\scripts\remove-demo-data.mjs --confirm-demo-data-removal
```

This cleanup targets only the fixed demo auction IDs and their associated fixture records; it does not delete user accounts or real auctions.
