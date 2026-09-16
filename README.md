# Pantry — local development

A household food inventory PWA. See `Spec` (in the project) for the full design.
This file is the day-to-day cheat sheet: running it, testing it, and deleting data
while you're playing around.

## Running it locally

```bash
npm install
cp .env.example .env    # fill in the values below, then:
npm run dev              # http://localhost:5173
```

`.env` needs:

| Variable | Where it comes from |
|---|---|
| `VITE_SUPABASE_URL` | Supabase dashboard → Settings → Data API |
| `VITE_SUPABASE_ANON_KEY` | Supabase dashboard → Settings → API Keys → **publishable** key (safe to ship — RLS is what protects data, not this key) |
| `VITE_USDA_API_KEY` | fdc.nal.usda.gov/api-key-signup — free, instant |

The Gemini key is **not** an env var — it's entered in the app itself (Settings), per device,
per browser. See "Where things are stored" below for why.

It is also **optional**, and deliberately narrow in scope. A model is used for recipe
ideas (a creative task with no right answer) and deciding which product a receipt
line names. Nothing that makes
the app *run* depends on one: adding, weighing, sorting, syncing, and reading a receipt
are all plain code, and work offline with no key and no quota. If you're adding a feature,
that's the line to hold — if the task has a right answer you could look up or compute,
compute it.

```bash
npm run build      # production build -> dist/
npm run preview    # serve the production build locally
```

## Checks before trusting a change

```bash
npm run smoke   # renders every screen headlessly, catches render-time crashes
                # a `vite build` misses these — it only checks that modules resolve
```

No conventional test runner is wired up; the logic-heavy modules (`units.js`,
`sortFilter.js`, `macros.js`, `llm.js` parsing, the sync merge rules) were verified with
one-off scripts during development rather than a committed suite. If you extend one of
those, write a quick script against it before trusting the change — see the `scripts/`
folder for the shape those took.

## `scripts/`

| Script | What it does |
|---|---|
| `rls-test.mjs` | Spins up two throwaway anonymous-ish sessions against your real Supabase project and checks cross-household reads/writes are actually refused by Postgres, not just unrequested by the app. Reads `.env`. |
| `food-lookup-probe.mjs` | Runs a real USDA + Open Food Facts search through the app's own ranking/dedupe/plausibility code and prints what survives. Useful after touching `foodQuality.js`. |
| `gemini-probe.mjs <key>` | Lists every model your Gemini key can call, then live-tests each candidate with the actual structured-output schema the app uses. Run this whenever recipes or receipt matching start 404ing — Google renames/retires models on its own schedule. |

```bash
node scripts/rls-test.mjs
node scripts/food-lookup-probe.mjs "greek yogurt"
node scripts/gemini-probe.mjs AIza...
```

## Deleting / resetting data while developing

### A known kitchen to work against (Settings → Development)

In `npm run dev` only, Settings grows a **Load sample kitchen** button: 20 items
across fridge, freezer and pantry, spread over dairy / meat / grains / produce and
across the macro axes (butter and bacon at the fat end, chicken and yogurt at the
protein end, rice and pasta at the carb end). It includes the awkward cases on
purpose — one expired item, one finished, counted items alongside weighed ones,
varied depletion — plus a day's intake already logged, so the Intake tab isn't
empty either.

Edit the list in `src/dev/sampleFridge.js`. One table feeds three things: the
button and the dev fixture — so they can't drift.

It **replaces** what's there. That's the point: somewhere known to come back to.
`import.meta.env.DEV` gates it, so the button and the data are dropped from a
production build entirely.

**Seeding the server instead** (so a phone or a family member's device pulls the
sample down without dev tools):

```bash
```

Then paste that file into the Supabase SQL editor, changing the household id on
the first line to yours. It's re-runnable — it clears its own rows first, and only
its own. One caveat: macros live in `food_cache`, which is per-device IndexedDB
and never syncs, so SQL-seeded items arrive without nutrition. Use the button if
you want macros.

### In the app (Settings → Reset)

For everyday "get me back to a clean slate," two buttons cover most of it, and both
sync to every device like any other change — no devtools, no SQL:

| Button | What it does | What it leaves alone |
|---|---|---|
| **Empty the fridge** | Soft-deletes every item in the household | All history. What you've already eaten still counts toward intake |
| **Undo today's intake** | Nets out what today's log says was eaten and appends one undo per item, putting intake back to zero | Earlier days. Safe to press twice — the second press nets zero and does nothing |

"Undo today's intake" also puts the food **back in the fridge**. That isn't a quirk to
work around: quantity and intake are both derived from the same event log, so there is
no way to say "I didn't eat this" without also saying "so it's still there."

Neither button wipes rows — items are soft-deleted and intake is reversed by appending,
so nothing below is needed unless you want the history itself gone.

### The two storage layers

**Server** (Supabase — shared, authoritative) and **local** (IndexedDB in each browser —
a cache/staging area for offline writes). Deleting one does not touch the other.

### Server-side, via Supabase Table Editor / SQL Editor

Dashboard writes bypass RLS entirely (you're using your own login, not an app session) —
this is the *only* place these deletes are meant to happen from.

**Remove one person's access to one household:**
Table Editor → `household_allowlist` → find the row (`household_id`, `email`) → Delete.
Takes effect next time they load the app (access is re-checked every sign-in, never cached).

**Delete one item and its history** (there's no FK from `events` to `items`, so clean both):
```sql
delete from events where item_id = '<item id>';
delete from items where id = '<item id>';
```

**Wipe all food data for one household, keep the household + allowlist:**
```sql
delete from events where household_id = '<household id>';
delete from items where household_id = '<household id>';
```

**Delete an entire household** — cascades to its allowlist rows, items, and events
automatically (`on delete cascade` on the foreign keys):
```sql
delete from households where id = '<household id>';
```

**Create a household** (the app can no longer do this — see security notes below):
Table Editor → `households` → Insert row → generate a UUID for `id`, give it a `name`.

### Local-side, per browser/device

The server deletion above does **not** clear what's already synced onto a device — deleting
`items`/`events` in Supabase removes them from future pulls, but a device that already
has them locally keeps its copy until you clear it.

- Fastest: DevTools → Application (Chrome) / Storage (Firefox) → IndexedDB → delete the
  `pantry` database → reload.
- Also clears the Gemini key, the remembered household, and the sync cursor (all in
  `localStorage`, same browser, not part of IndexedDB but worth knowing when doing a full
  reset): DevTools → Application → Local Storage → delete the `pantry.*` keys, or just
  clear site data for the origin entirely.
- Sign-out (Settings → Sign out) clears the remembered household and the auth session, but
  currently does **not** wipe IndexedDB — a re-signed-in device still has its old local
  cache until the next successful sync reconciles it. Worth knowing if you're testing
  "remove access" and still see stale data locally until you clear site data.

## Where things actually live (security summary)

**Three tiers of trust, not one:**

- The Supabase *publishable* key (in the built bundle) identifies the **project**. Anyone
  with the URL can read it. It grants nothing by itself.
- Your **session** (from signing in with email) identifies **you**. This is what every
  permission check actually runs against.
- The USDA and Gemini keys touch no household data at all — worst case if leaked, someone
  spends your quota.

**Access is per-email, not per-household-secret.** There are no join codes. A household's
`id` is just an identifier now — knowing it grants nothing. `household_allowlist` maps
`(household_id, email)` pairs, and Postgres Row Level Security checks every request
against the email inside your signed session token, not against anything the client sends.
No insert/update/delete policy exists on that table, so **no request from the app, from
any signed-in user, can write to it** — the only door is the Supabase dashboard, i.e.
whoever holds that login. Turn on 2FA there; it is the actual master key now.

**What's scoped by household vs. by device vs. by browser** — these are three different
things and it's easy to conflate them:

| Data | Scoped by | Where it lives |
|---|---|---|
| Items, events (the actual food log) | household (`household_id` column, RLS-enforced) | Supabase (authoritative) + IndexedDB (local cache, syncs both ways) |
| Food/nutrition cache (`food_cache`) | nothing — global per device | IndexedDB only, never synced. Reference data; cheap to lose, cheap to rebuild. |
| Expiry estimates (`expiry_cache`) | food name, not household | IndexedDB only, never synced. Two households buying "whole milk" each pay for their own cache — not shared, not leaked either. |
| Sync cursor (`pantry.last_synced_at.<id>`) | household, within one browser | `localStorage` |
| Remembered household (`pantry.household_id`) | device (one browser can only "remember" one at a time) | `localStorage` |
| Device id (`pantry.device_id`) | device — random, generated once, only used as an audit tag on events | `localStorage` |
| Gemini API key | **browser, not household, not account** | `localStorage` only — never synced, never in the built bundle |

The Gemini key row is the one worth internalizing: it is **not** "per email account."
It's per browser. Signing in as the same person on a second phone does not carry the key
over — each device that wants expiry estimates needs its own key pasted into Settings
there. This is deliberate: syncing a billable API key through the household's shared data
would mean anyone with household access could spend it from any device, silently.

**What "safe" currently rests on** — the honest dependency list, not a vague assurance:
1. Control of the email inboxes on the allowlist. Compromise the inbox, compromise access.
2. Your Supabase account password/2FA — the only thing that can edit the allowlist at all.
3. Sign-in links not being forwarded (they're bearer tokens, short-lived but real while live).

It does **not** rest on: the app URL staying secret, the publishable key staying secret, or
anyone remembering not to share something. Those all stop being load-bearing once patch-003
is applied.

## Verified, not just asserted

The RLS/allowlist behavior above was tested against a real local Postgres before being
applied to the live project (not just reasoned about): a listed address sees only its own
households; an unlisted address sees zero rows and cannot even list household names; a
member of one household cannot read or write another's; **no signed-in session — listed or
not — can insert, update, or delete allowlist rows**; email matching is case-insensitive
and a null/missing email matches nothing. `scripts/rls-test.mjs` runs a lighter version of
this against your actual project if you want to re-check it after a schema change.
