# AURA 2026

Registration site for the AURA 2026 symposium at Sankara Polytechnic College
(30–31 July 2026): a cinematic 3D event journey, a public registration form,
a live admin dashboard with Excel export, and a local AI agent over MCP.

## Quick start

```bash
npm install
cp .env.example .env      # then set a real ADMIN_PIN and ADMIN_PASSWORD
npm run dev               # site + API together
```

Development runs Vite (site) and the API on port `1215`, with `/api` proxied.

## Production

One process serves both the built site and the API:

```bash
npm run build
npm start                 # http://localhost:1215
```

Set these before going live:

```bash
ADMIN_PIN=…               # 4 digits
ADMIN_USER=…
ADMIN_PASSWORD=…          # long and random
API_HOST=0.0.0.0          # only when the port is intentionally exposed
TOTAL_CAPACITY=200        # optional hard cap; omit or 0 for unlimited
```

Generate strong credentials:

```bash
node -e "console.log(require('crypto').randomInt(1000,10000), require('crypto').randomBytes(12).toString('base64url'))"
```

Put the app behind a TLS terminator (Nginx, Caddy, Cloudflare) in production;
the session cookie is marked `Secure` automatically when it sees
`X-Forwarded-Proto: https`.

## Database — Supabase (required for the live site)

Registrations are stored in Supabase Postgres so they survive redeploys and are
shared by every instance. In production the server **refuses to start** without
it, rather than silently writing to a local file that would be lost.

### Setup (once)

1. **Create the tables.** Supabase dashboard -> **SQL Editor** -> **New query**,
   paste the whole of `supabase-schema.sql`, click **Run**.
2. **Copy your keys.** **Project Settings -> API**:
   - *Project URL* -> `SUPABASE_URL`
   - *service_role* secret (click **Reveal**) -> `SUPABASE_SERVICE_ROLE_KEY`
3. **Put them in `.env`**, then verify:

```bash
npm run check-db
```

That script checks the URL and key format, connectivity, that the table and
both functions exist, and that duplicate protection is active. It writes one
test row and deletes it again. Fix anything it reports before publishing.

4. **Run it:**

```bash
npm run dev      # development
npm start        # production (build first)
```

You should see:

```
Storage: Supabase (permanent cloud database) — connected.
```

If it says `local SQLite file`, the two variables are not set.

### What the database guarantees

- **No duplicates.** UNIQUE indexes on normalised email and phone *per event*,
  enforced by Postgres, so two simultaneous submissions cannot both win.
- **Atomic capacity.** `create_registration()` takes an advisory lock before
  counting, so the last place cannot be given to two people.
- **Eligibility.** A trigger blocks Year 3 from the non-technical events even if
  the request bypasses the form.
- **Year 3 places.** Bug Hunt and Debate each allow only five Year 3 students.
  Counted per person, so a Debate team with two Year 3 members uses two places.
  Enforced inside the insert with an advisory lock, so the last place cannot be
  claimed twice.
- **Locked down.** Row Level Security is on with no public policy. Only the
  server's service_role key can read or write.

### Getting `SUPABASE_URL` right

`SUPABASE_URL` must be the **Project URL** from *Project Settings -> API*:

```
https://<project-ref>.supabase.co
```

It is **not** the database connection string from *Connect -> URI*
(`postgresql://postgres:PASSWORD@db.<ref>.supabase.co:5432/postgres`). That one
is for a Postgres driver and contains your database password.

If a connection string, a `db.<ref>…` host, a bare hostname or a bare project
ref is supplied, the server now derives the correct API URL, logs a warning and
keeps serving — instead of failing every request. `/api/health` shows the
warning under `configWarning` and the URL actually in use under `databaseUrl`.
Secrets are stripped from every error message, so the password is never echoed
back.

> If your password was ever stored in `SUPABASE_URL`, rotate it:
> *Project Settings -> Database -> Reset database password*.

### If the database goes down

The site stays up. Registrations return a clear "please try again in a moment"
message with HTTP 503, reads fall back to the last known counts, and the API
retries transient failures three times with backoff. `/api/health` reports
`database: unreachable` so your monitoring can alert you.

## Deploying

Any Node 22+ host works. One process serves both the site and the API.

```bash
npm install
npm run build
NODE_ENV=production npm start
```

Required environment variables in production:

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role secret |
| `ADMIN_USER`, `ADMIN_PASSWORD`, `ADMIN_PIN` | dashboard access |
| `API_HOST=0.0.0.0` | listen on all interfaces |
| `NODE_ENV=production` | enforces the database requirement |
| `TOTAL_CAPACITY` | optional hard cap |

### Vercel

`vercel.json` and `api/index.js` are included. Import the repository at
vercel.com, then add the environment variables below in **Settings ->
Environment Variables**. Vercel serves `dist/` from its CDN and routes
`/api/*` to a serverless function that reuses the same request handler.

On Vercel you **must** also set `SESSION_SECRET` to a long random string:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Requests land on different instances, so admin sessions are signed cookies
rather than server memory; without a shared secret administrators would be
logged out at random. `/api/live` returns a single snapshot instead of a
stream there, which the dashboard handles because it polls.

### Other hosts

`Dockerfile` and `render.yaml` are included. Point health checks at
`/api/health`, which returns 503 when the database is unreachable.

Put the app behind HTTPS; the session cookie upgrades to `Secure` automatically
when it sees `X-Forwarded-Proto: https`.

## Admin

Drag the small dot in the corner more than five times to reveal the terminal,
then enter the PIN followed by the username and password. The dashboard shows
live totals, a searchable and paginated table of every registration, and
buttons to download the list as **Excel (.xlsx)** or CSV. It refreshes every
five seconds while "Live" is ticked.

Each row has a **REMOVE** button to delete that single registration (with a
confirmation prompt), and a **DELETE ALL** button in the toolbar to wipe the
entire table (with two confirmations, since it cannot be undone). Both call
`DELETE /api/admin/registrations/:id` and `DELETE /api/admin/registrations`
respectively, require an authenticated admin session, and update Supabase (or
the local SQLite file) immediately — every connected dashboard refreshes to
match.

## Exports

From the dashboard, or from the command line:

```bash
npm run export            # writes exports/aura-2026-registrations-YYYY-MM-DD.xlsx
npm run export -- csv
```

The `.xlsx` is a real spreadsheet with a frozen, filtered header row. Phone
numbers stay text, so leading zeros survive.

## The schedule

`src/schedule.js` is the single source of truth for days, dates, times, venues,
team sizes and per-event dropdowns. The 3D journey, the schedule panel, the
registration cards and the form all read from it — edit it in one place.

## Local AI agent (MCP)

```bash
npm run mcp
```

A stdio JSON-RPC MCP server (no URL — clients launch it as a child process):

```json
{
  "mcpServers": {
    "aura": {
      "command": "node",
      "args": ["/absolute/path/to/collage-registration/mcp-server/index.js"]
    }
  }
}
```

Tools: `list_registrations`, `export_excel`, `search`, `analytics`,
`live_dashboard`, `report_generation`, `event_management`,
`registration_validation`, `database_query`, `admin_commands`, `chat`.

`export_excel` writes a real `.xlsx` to `exports/` and returns the path. `chat`
is the only tool needing Ollama:

```bash
OLLAMA_MODEL=llama3.2 OLLAMA_URL=http://127.0.0.1:11434 npm run mcp
```

## Tests

```bash
npm test
```

Covers validation, duplicate rejection, capacity limits, search, pagination,
bulk inserts and both export formats.
