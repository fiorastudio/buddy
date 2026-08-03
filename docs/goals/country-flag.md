# Goal: country flag on teleport (retire the job-class label)

## Goal
When a buddy teleports into the plaza, show a **country flag** derived from the
teleport request's origin — replacing the current job-class nameplate line
(`Bard · Lv.10`). The job-class logic stays in the code but **dormant** (not
rendered), so it can be revived later.

## Why it's cheap
Cloudflare Workers expose the request's country for **free** as
`request.cf.country` (ISO 3166-1 alpha-2, e.g. `US`, `JP`) — no third-party
geolocation API, no extra latency. It's derived **server-side from the IP**, so
it's not client-spoofable the way a self-reported field would be.

## Definition of done
1. Teleport stores the citizen's `country` from `request.cf.country` (server-side).
2. `/v1/world/:district` returns `country` per citizen.
3. The plaza renders the **flag emoji** for that country on the nameplate; the
   job-class label (`jobLabelForSlug` / "Bard") is **no longer rendered** (code
   kept, just not called).
4. **Anonymous mode hides the flag** (anon = minimal identity — no name, no flag).
5. Country code is sanitized to `[A-Z]{2}` before store/render; unknown/missing →
   no flag (graceful).
6. Migration applied to D1; full suite green; deployed to preview and verified
   (a real teleport shows a flag); `test:e2e:live` still passes.

## Privacy
- Coarse **country-level only** — no city, no precise location, no IP stored.
- Only appears for opt-in teleported buddies; hidden in anon mode.
- Update the CLI privacy note to mention a country flag is shown (still no code /
  prompts / messages).

## Non-goals
- Precise / city-level geolocation, external geo APIs, or storing the raw IP.
- Removing the job-class system — it goes dormant, not deleted.

## Implementation sketch
- **Migration** `world/migrations/0002_country.sql`: `ALTER TABLE citizens ADD
  COLUMN country TEXT;` (+ mirror in `schema-sql.ts` for the exec/create path).
- **worker-core**: read `req.cf?.country` (fallback `cf-ipcountry` header),
  normalize to `[A-Z]{2}`, thread into the teleport handler.
- **handlers/store/d1-store**: `teleport(...)` accepts `country`, writes it;
  world read returns it; anon toggle unaffected (flag hidden client-side on anon).
- **plaza.js**: `flagEmoji(country)` from regional-indicator codepoints; render on
  the nameplate instead of the job label; skip when `anon` or no country.
- **types**: add optional `country` to the citizen/world row types.

## Verification
- Unit: handler stores/returns country; anon omits flag (client).
- Live: `npm run test:e2e:live` still green; manual teleport shows the flag.
