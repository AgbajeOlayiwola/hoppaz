# Play API: database contract for the client (Phase 1)

What `supabase/play.sql` gives the app. Everything is an RPC called with the signed-in session (anonymous guests count as signed in). Spec: [PLAY-MODE.md](PLAY-MODE.md). Plan: [PLAY-BUILD-PLAN.md](PLAY-BUILD-PLAN.md). Tests: `supabase/tests/play_test.sql`.

Load order: schema.sql, chat_accounts.sql, hunt_items.sql, spawning.sql, spawn_points_lagos.sql, box_guards.sql, daily_box.sql, then play.sql last. Re-running spawning.sql or schema.sql puts the old `claim_game_drop` and welcome layout back, so run play.sql again after them.

## `play_tick(p_lat, p_lng, p_accuracy)`

The heartbeat. Call it when Play opens and then every 20 s (30 s on low tier), paused while the tab is hidden.

| Argument | Type | Notes |
|---|---|---|
| `p_lat`, `p_lng` | double precision | The real fix. The server stores only a copy rounded to 3 decimals (about 110 m) and places small boxes around the exact point you send. If the client rounds first, boxes can sit up to about 80 m further away than the stated ranges. |
| `p_accuracy` | double precision, optional | Metres. Stored, never used for a decision in Phase 1. A negative or missing value is ignored. |

What it does on each call: checks the session, Lagos bounds and the rate limit, writes `play_fix`, and returns the Hopper's open boxes. On the first call, and then whenever the last full pass is older than about 50 s (every third tick at 20 s), it also does the heavy work: retires small boxes more than 400 m behind you and tops up to 3 live small boxes. Guests get no small boxes, only their welcome boxes.

### Success

```json
{
  "ok": true,
  "full": true,
  "night": false,
  "play_day": "2026-10-09",
  "small_left_today": 10,
  "welcome_left": 0,
  "boxes": [
    {
      "id": "6c0f9b3e-2a41-4d6e-9d52-0a7b8e1c4f10",
      "kind": "near",
      "tier": "common",
      "lat": 6.45134,
      "lng": 3.39721,
      "closes_at": "2026-10-09T16:42:11.52+00:00",
      "needs_presence": false,
      "slot": null
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `full` | `true` when this call did the heavy pass. Informational. |
| `night` | `true` from 21:00 to 06:00 Lagos. Small boxes then sit 20 to 60 m away (60 to 150 m by day). Drive the night chip from this. |
| `play_day` | Lagos play-day, `YYYY-MM-DD`. The day turns over at 06:00 Lagos, not midnight. |
| `small_left_today` | Small boxes the Hopper can still open this play-day (10 a day). Always 0 for a guest. At 0 with no small box on the map, show "Tomorrow's box is sealed". |
| `welcome_left` | Welcome boxes in `boxes` (live and not yet opened). |
| `boxes` | The Hopper's own boxes that are open now and not yet opened. Opened and expired boxes drop out. A replacement is created 40 to 90 s after an open but only appears on the next full pass, so allow up to about a minute and a half. |

Fields of a box:

| Field | Values |
|---|---|
| `id` | The `game_drops` id to pass to `claim_game_drop`. |
| `kind` | `near` (small box) or `welcome`. Later phases add `special`. |
| `tier` | `common` for a small box, `rare` for welcome A and B, `legendary` for welcome C (the 150 XP one). Tier colours: Common cream, Rare violet, Epic pink, Legendary gold. |
| `lat`, `lng` | Where to draw the crate. Exact, owner only. |
| `closes_at` | ISO timestamp. Small boxes live 2 hours, welcome boxes 24 hours. |
| `needs_presence` | `false`: send the avatar, claim with no coordinates. `true`: the Hopper must walk there and claim with the real position. |
| `slot` | `"a"`, `"b"`, `"c"` for a welcome box, `null` otherwise. A is the four-box reveal, 25 m away. B is 90 to 130 m. C is 180 to 250 m and needs real GPS. At night all three are 15 to 45 m away and C still needs presence. |

### Refusals

`ok` is `false` and `reason` says why. Nothing else is returned and nothing is written, except as noted.

| `reason` | When | Suggested copy |
|---|---|---|
| `no_session` | No signed-in user yet. | No copy. Wait for the session, retry. |
| `location_required` | Latitude or longitude missing or not a number. | "Turn on location to open boxes." |
| `outside_lagos` | Outside lat 6.30 to 6.80, lng 3.05 to 3.95. | "Play is Lagos only for now." |
| `too_soon` | Less than 15 s since the last accepted call. Also has `retry_in_s` (1 to 15). | No copy. Skip this beat. |
| `need_account` | A guest who has opened all three welcome boxes. | "Sign up to keep playing. Your boxes are waiting." Open the sign-up sheet in place. |

A Hopper standing inside a no-spawn zone (lagoon, military site, estate) gets `ok: true` with no new small boxes; keep the tray quiet or say "No boxes here. Try moving a bit."

### Limits

- One accepted call per 15 s per Hopper (refused calls do not move `play_fix`).
- 3 small boxes live at a time, 10 opened per play-day, at most 30 rows made per play-day (walking about cannot churn rows).
- Small boxes: 60 to 150 m away by day, 20 to 60 m at night, 40 m apart (15 m at night), never inside an active no-spawn zone.
- Guests (no email) may call it until the three welcome boxes are opened. They get welcome boxes only.
- `play_fix` is not readable by the app. The server keeps one rounded position per Hopper for 24 hours (nightly purge).

### Welcome boxes

`spawn_welcome_boxes(p_lat, p_lng)` keeps its signature and answer (`ok`, `already`, `night`, `ids`, or `reason` `no_session`, `location_required`, `outside_lagos`, `no_clear_spot`). Only the layout changed (above). `play_tick` returns the three boxes once they exist; it does not create them. Call `spawn_welcome_boxes` first, with a fresh fix.

## `claim_game_drop(p_drop, p_lat, p_lng, p_code)`

Same function and same answer as before, plus a remote path.

- **Remote path**: when the box has `needs_presence = false` (small box, welcome A and B) and belongs to the caller, pass no coordinates. There is no radius check, no speed check, and the claim row stores no latitude or longitude, even if coordinates are sent. Only `near` and `welcome` boxes owned by the caller can be opened this way; any other drop still needs a position, whatever its flag says.
- **Presence boxes** (welcome C, staff and street boxes) are unchanged: pass the real position, radius and the 50 m/s speed rule apply, the position is stored. Phase 2 tightens this.
- **Account gate**: unchanged. A guest may open their own welcome boxes (all three, A and B remotely, C with GPS). Anything else needs an account. For a small box the function answers `need_account` instead of raising; for presence boxes the database trigger still raises the error `need_account`. The client should ask for an account before the tape rips.
- Small boxes pay 10 XP (`Small find`), welcome A and B 50 XP, welcome C 150 XP by day and 50 XP at night. Small boxes score 0 on the Outside Score board, like street and welcome boxes.

Success:

```json
{ "ok": true, "claim_id": "0d5b2c7a-91e3-4c58-8f0a-3b6e7d21a9c4", "reward": "Small find", "description": "", "code": null, "xp": 10 }
```

Refusals (`ok: false`):

| `reason` | Meaning | Suggested copy |
|---|---|---|
| `no_session` | Not signed in. | Retry after the session starts. |
| `not_yours` | Somebody else's box. Should not happen. | Remove the crate quietly. |
| `closed` | Not open yet, expired, or retired. | Remove the crate quietly, no copy. |
| `sold_out` | Already opened. | Remove the crate quietly. |
| `already` | Same, from a repeat call. | Remove the crate quietly. |
| `need_account` | A guest tried a small box (or any non-welcome remote box). | "Sign up to open this box." Open the sign-up sheet. |
| `location_required` | A presence box with no position. | For welcome C: "This one needs a walk. Go to the crate." |
| `too_far` (`distance_m`) | A presence box, outside its radius. | "Get closer to open it. About {distance_m} m to go." |
| `too_fast` | Two located claims too close in speed. | "Slow down a little and try again." |
| `slow_down` | 6 street boxes in an hour (street boxes only). | "Hold on, you are opening a lot. Try again soon." |
| `invalid_code`, `code_required` | QR boxes only, unchanged. | As today. |

## Also available

- `lagos_play_day(p_ts default now())` returns the play-day date, `lagos_play_day_start(p_ts default now())` returns its 06:00 Lagos start. Both callable by the app, for example to schedule the 06:00 reset copy.

## Not in this phase

The 150 XP box ceiling, claim speed rule v2 and accuracy radius, collectible delivery (Phase 2), the special box (Phase 3), spots, rooms and `start_trip` (Phase 4). `play_tick` will gain `spots` and `alerts` keys later; ignore keys you do not know.
