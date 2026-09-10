# Pantry — persistence & identity specification

Authoritative reference for where every piece of state lives, what scopes it, and what
syncs where. Written after feature 7 + the security rework (patch-003). If behavior and
this doc ever disagree, treat that as a bug in one of them and reconcile — don't assume
the doc is stale by default.

---

## 1. The three storage locations

| Location | Technology | Lifetime | Shared across devices? |
|---|---|---|---|
| **Server** | Supabase (Postgres) | Permanent, authoritative | Yes — this is the shared truth |
| **Local cache** | IndexedDB (Dexie), table-based | Until cleared / uninstalled | No — per browser origin |
| **Local settings** | `localStorage`, key-value | Until cleared / uninstalled | No — per browser origin |

IndexedDB and `localStorage` are both scoped to the browser's **origin** (the deployed
URL). A different browser, a different device, or a private window is a completely
separate local store, even when signed into the same email.

---

## 2. Identity model

```
  email address  ──sign in──▶  Supabase session (JWT, carries the email)
        │
        │  household_allowlist: (household_id, email) rows
        ▼
  set of households this email may reach
```

- There are **no join codes, no passwords, no per-person roles**. One binary fact per
  `(household, email)` pair: listed, or not.
- The session's email is asserted by Supabase's auth system from a magic-link click — the
  client cannot forge or choose it.
- `household_allowlist` has **no INSERT/UPDATE/DELETE policy for any role reachable from
  the app**. It is writable only via the Supabase dashboard (your login), or direct SQL as
  the Postgres superuser. This is the entire access-control surface for the whole app —
  everything else derives from it via `can_access_household(household_id)`.
- A household's `id` (UUID) is **not a secret**. It used to be (join-code era); it no
  longer functions as one. Knowing it grants nothing without an allowlist row.

---

## 3. Server-side tables (Supabase / Postgres)

### `households`
| Column | Notes |
|---|---|
| `id` (uuid, PK) | Created by hand in the dashboard. Not a secret. |
| `name` | Display name shown in the app (household picker, header). |
| `created_at` | |

RLS: `SELECT` only, gated by `can_access_household(id)`. No `INSERT` policy — the app
cannot create households.

### `household_allowlist`
| Column | Notes |
|---|---|
| `household_id` (uuid, FK → households, cascade) | |
| `email` (text) | Normalized to lower-case + trimmed by a `BEFORE INSERT/UPDATE` trigger, so dashboard typos ("Mom@Gmail.COM ") still match a login as typed. |
| `added_at` | |

PK: `(household_id, email)`. RLS: `SELECT` only, and only rows where
`email = lower(auth.jwt() ->> 'email')` — **you can see which households you're on, not
who else is on them.** No write policy at all for any authenticated role.

### `items`
| Column | Notes |
|---|---|
| `id` (uuid, PK) | Client-generated (`crypto.randomUUID()`), not server-assigned — required for offline creation without collision. |
| `household_id` (uuid, FK → households, cascade) | Everything hangs off this. |
| `name`, `category`, `location`, `base_unit`, `display_unit`, `food_db_id`, `expiry_date`, `expiry_estimated` | Metadata. |
| `deleted` (boolean) | Soft delete. |
| `created_at`, `updated_at` | `updated_at` drives last-write-wins merge on pull. |
| `server_updated_at` | **Server-assigned only**, via trigger — devices cannot write it. This, not `updated_at`, is the sync cursor's clock, because device clocks disagree and a device-authored cursor can silently skip rows. |

RLS: `SELECT`/`INSERT`/`UPDATE` all gated by `can_access_household(household_id)`. No
`DELETE` policy — deletion is the soft-delete flag via `UPDATE`, never a row removal, so a
device that hasn't synced yet still learns an item was removed.

### `events`
| Column | Notes |
|---|---|
| `id` (uuid, PK) | Client-generated. |
| `household_id`, `item_id` | **No FK from `item_id` to `items.id`.** Deliberate: an offline device can push an event before its item lands; a FK would reject it instead of letting it settle a moment later. |
| `type` | `add` \| `remove` \| `consumed_remainder` \| `undo`. |
| `quantity_delta` | Signed. Current quantity = `max(0, sum(quantity_delta))`, always derived, never stored. |
| `entered_value`, `entered_unit` | What the user actually typed (e.g. `2, "oz"`), kept alongside the converted base-unit delta, so the log can say "2 oz" instead of "-56.7". |
| `undone_type` | Set only on `undo` events — which event *kind* this reversed, so macros can tell "undid a purchase" from "undid eating something." |
| `timestamp`, `device_id` | `device_id` is audit-only, never used for access control. |
| `server_updated_at` | Same server-clock rule as `items`. |

RLS: `SELECT`/`INSERT` gated by `can_access_household`. **No `UPDATE`, no `DELETE`,
anywhere, for anyone, including the dashboard-editable allowlist owner acting through the
app.** The log is append-only by construction — a mistake is corrected by appending its
inverse (this is what Undo does), never by rewriting history. (You, in the SQL editor as
Postgres superuser, *can* still delete rows directly — see the README's cleanup section —
but no path through the app or RLS-governed role can.)

**Not present:** any table keyed by email/user for household data. There is no per-user
subdivision of items or events within a household — access is binary (in the household or
not), and once in, everyone with access sees and edits the same rows.

---

## 4. Local cache — IndexedDB (Dexie), database name `pantry`

All tables below live in **one Dexie database per browser origin**. Nothing here is
per-email; it's per-device-per-browser.

| Table | Synced to server? | Scoped by | Notes |
|---|---|---|---|
| `items` | Yes, bidirectional | `household_id` column | Local mirror of the server table. Optimistic: writes land here instantly, sync pushes after. |
| `events` | Yes, bidirectional | `household_id` column | Same. Append-only locally too. |
| `pending_sync` | N/A — this *is* the outbox | — | Queue of not-yet-pushed writes. A row is enqueued in the **same transaction** as the local write, so a write can never exist locally without a corresponding sync record. Drained on push success; left queued (never dropped) on failure. |
| `food_cache` | **Never synced** | nothing (global per device) | USDA/Open Food Facts lookup results, keyed by `food_db_id`. Pure reference data — cheap to lose (one API call to rebuild), so not worth the sync complexity. Two people in the same household each build their own copy on first use. |
| `expiry_cache` | **Never synced** | food name + category (not household, not item) | Gemini shelf-life estimates, keyed by `shelfLifeKey(name, category)`. A given food is asked about once **ever, per device** — not per household, not per item. Two different households buying "whole milk" each pay for their own estimate; this is intentional (simplicity) rather than a privacy boundary. |

**Dexie schema versions**, for context on why a fresh install and an old device can
disagree: `v1` (original per-item units), `v2` (base-unit rework — wiped `items`/`events`),
`v3` (dropped volume units — wiped again). Each wipe was a deliberate, announced
breaking change, not data loss in normal operation. Current installs are on `v3`.

---

## 5. Local settings — `localStorage`

All keys are prefixed `pantry.`. **None of these are namespaced by email or account** —
they are pure per-browser state.

| Key | Scoped by | Purpose | Consequence of clearing |
|---|---|---|---|
| `pantry.llm_api_key` | **browser only** | The user-supplied Gemini API key. | Expiry estimation stops until re-entered. Nothing else affected. |
| `pantry.llm_model` | browser only | Which Gemini model name last worked (models get retired; this avoids re-probing every call). | Falls back to trying the hardcoded list again from the top. |
| `pantry.household_id` | browser only | Which household this device is currently viewing. | Falls back to the household picker (or auto-selects if the signed-in email has access to exactly one). |
| `pantry.device_id` | browser only, generated once via `crypto.randomUUID()` | Stamped on outgoing events as `device_id`, **audit-only** — never read for access control or sync logic. | A new one is generated; only cosmetic effect is future events look like they came from a "new" device. |
| `pantry.last_synced_at.<household_id>` | browser + household (one entry per household this device has synced) | The pull cursor — `server_updated_at` timestamp of the newest row seen. | Next sync re-pulls everything from epoch for that household. Slower once, not lossy — pulls are idempotent. |

**The one deliberately unsynced secret in the whole app is `pantry.llm_api_key`.** It is
never written to Supabase, never included in the built bundle (unlike the Supabase
publishable key and USDA key, which *are* baked in at build time — see §6), and does not
follow a person across devices. Signing in as the same email on a second phone does not
carry it over; it must be re-entered there. This is intentional: if it synced via the
household's shared data, anyone with allowlist access could spend the key's quota from any
device, silently, with no way to attribute or revoke per-device.

**Auth session storage:** the Supabase JS client keeps its own session/refresh-token state
in `localStorage` under its own key (not `pantry.`-prefixed, managed entirely by
`@supabase/supabase-js`). Not enumerated above because Pantry code never reads or writes
it directly — mentioned so "clear site data" is understood to also sign the device out.

---

## 6. Build-time vs. runtime secrets

| Secret | Where it lives | Who can read it |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Baked into the built JS bundle at `npm run build` | Anyone with the deployed URL — **by design**. This key identifies the *project*, not a person; it grants a knock on the door, RLS decides what opens. |
| `VITE_USDA_API_KEY` | Baked into the bundle | Anyone with the URL. No RLS-equivalent exists for USDA — worst case if scraped, someone burns your hourly quota. Low stakes, so this tradeoff was accepted rather than proxied through a server. |
| Gemini API key | **Never in the bundle.** Entered per-device into Settings, stored in that browser's `localStorage` only. | Only someone with script execution on that specific browser tab. Bills real money per call, unlike the other two — this is why it's handled differently. |
| Supabase `service_role` key | Nowhere in this codebase. Never generated, never pasted anywhere by design. | N/A — if this ever needs to exist for a future feature, it must live server-side only, never in `.env` for the Vite app. |

---

## 7. Quick answers to likely future questions

- **"Does X sync across my devices?"** — If X is inventory/consumption data: yes, via
  `household_id`, as long as both devices are signed in with an allowlisted email for that
  household. If X is the Gemini key, sort/filter preferences, or which household is
  "remembered": no, those are per-browser.
- **"If I remove someone from the allowlist, when do they lose access?"** — Immediately in
  effect server-side (RLS is evaluated per-request); in effect on their device the next
  time it makes a request that requires re-checking access (app load / sign-in). Their
  already-synced local IndexedDB copy of the data is **not remotely wiped** — see the
  README's "local-side reset" section if you need to guarantee a device has nothing left.
- **"Can two households share cached food/expiry data to save API calls?"** — Not
  currently; both caches are per-device with no household scoping at all, so there's
  nothing to "share" even within one household across two phones. Each device rebuilds its
  own on first use of a given food.
- **"Is there any table that's keyed by user/email for household data?"** — No.
  `household_allowlist` is the only table where email appears, and it exists purely to
  answer "may this email reach this household," not to attribute or scope any inventory
  data per-person.
