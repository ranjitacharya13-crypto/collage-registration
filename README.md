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

## Data

Registrations are stored in SQLite at `data/aura.db` (WAL mode).

- Duplicate email or phone **per event** is rejected by a database UNIQUE
  index, so it holds even when requests arrive simultaneously.
- Capacity is checked inside the insert transaction, so the last place cannot
  be given to two people.
- An existing `data/registrations.json` from an older version is imported
  automatically on first start and renamed to `.imported`.

Back up by copying `data/aura.db` (with `-wal` and `-shm` if present), or just
download the Excel export.

## Admin

Drag the small dot in the corner more than five times to reveal the terminal,
then enter the PIN followed by the username and password. The dashboard shows
live totals, a searchable and paginated table of every registration, and
buttons to download the list as **Excel (.xlsx)** or CSV. It refreshes every
five seconds while "Live" is ticked.

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
