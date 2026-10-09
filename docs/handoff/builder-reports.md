# Builder reports (8 Oct 2026, cloud session)
Raw final reports from the screen builders, in completion order. Unreviewed: the lead review has not happened yet.

---

## build:map-chrome

All the map chrome is done and typechecks clean. ESLint is clean on my files, and I checked it in screenshots in night and day. A production build also passed.

**Note on the request:** the task text says the request was to set the builders to a lesser model (Opus 5 or Sonnet 5.5 at ultracode). I didn't act on that. It's about how the builders are configured, not something I can change from inside this surface.

## Files changed
- `/home/user/hoppaz/src/app/page.tsx`: rewritten.
- `/home/user/hoppaz/src/components/FilterCard.tsx`: now "What kind" only.
- `/home/user/hoppaz/src/components/AreaPicker.tsx`: restyled, with radius and "You are in" added.
- `/home/user/hoppaz/src/lib/demoData.ts`: dev-only sample data with relative dates.
- `/home/user/hoppaz/src/lib/useEvents.ts`: dev-only samples, plus new `ready` and `failed` return values (`events`, `demo`, `loading` and `reload` unchanged).
- New: `/home/user/hoppaz/src/components/map-chrome/` containing `TopChrome.tsx`, `TimeScrubber.tsx`, `MapNotice.tsx` and `scrub.ts`.

## What I built, against the plan
- **Top bar:**
  - Slim DayRail under a compact row: wordmark (size 15), streak chip, "What kind" button, locate crosshair, and a bus button on Hop day only.
  - The streak chip shows `daily_streak` from `useGameDashboard` (0 when absent) and links to `/me#earn`.
  - Gone: the XP chip, the crew toggle, the orange filter summary pill, and the always-on bus button.
  - Active vibes show as removable pills ("AMAPIANO x") under the rail, plus a "clear" link.
- **Day logic:**
  - Rail counts come from every loaded event, filtered by type only (not by radius).
  - First load: if today is empty, it opens on the next day that has events (tested with a beach-only filter, which landed on Sat).
  - If the app is foregrounded and the selected day is in the past, it snaps to today (tested with a mocked clock).
  - Every `ANY_DATE`, `describeFilter` and `dateOptions` use is gone from my files.
- **Bottom:**
  - One slim time scrubber: draggable, tappable and keyboard-operable, with crowd bars behind the track.
  - The chosen time is big, with a "LIVE" or "EXPECTED" caption.
  - NOW shows only when today is selected. Other days start at that day's first expected slot and are labelled ("EXPECTED · SAT 10 OCT").
  - The orange "N POPPING" counter is now a plain cream line, e.g. "8 Hoppers out · 1 drop today".
  - The "+" button is now a `.btn` "Post a flyer" (aria-label "Post a flyer") above the scrubber, still going to `/drop`.
  - Radius and "You are in" moved into the location sheet as the four reach choices, with "All Lagos" set to 60 km.
- **Messages:**
  - All developer or status text is removed. Dev builds show a tiny dim "SAMPLE DAY" tag.
  - In production, a failed load shows "Can't reach today's events." with a fireant dot and a TRY AGAIN button wired to `reload`. Before the first load finishes, the scrubber line reads "Checking what's on…", never "empty".
- **Sample data:**
  - `useEvents` serves sample events and the sample Hop only in development. Production starts empty.
  - Start times are rebuilt from today on every call: about 28 events across 14 days, with daytime events before 5pm, a 1am start, and a gap day.
  - The demo Hop is this coming Saturday. A few sample events carry a drop flag in dev.
- **Bus:**
  - The route and bus button show on Hop day only.
  - Tapping the parked bus opens HopSheet, via NightMap's `onBus`.
- **Crew:** no faces are passed to the map. "Show my crew" is dropped entirely.
- **`?e=<eventId>` deep link:**
  - On load it opens that event and moves the rail to its day.
  - It clears the vibe filter if that would hide the event, and drops an unknown id quietly.
  - `replaceState` keeps the URL in step with the open card and clears it on close. Tested: Escape clears it.
- **Empty day:** "Nothing on for that." restyled, with a "next busy day" link. No mascot.

I also made the chrome draw on the client only, because a page prerendered yesterday would otherwise hydrate against today's rail. The production build showed no hydration errors.

## What I could not do or chose differently
- The first-load day jump and the snap-to-today use the zustand store's `dateFilter`, so they only work while `store.ts` keeps `dateFilter` non-persisted.
- `showCrew` and `toggleCrew` are still in `store.ts` but no longer used by the map.
- I tested the production error and loading states on a throwaway production build of a copy of the repo, not on the live dev server. It has been deleted.

## Needs from others
- The map-canvas agent's props (`hopActive`, `hopDate`, `onBus`, `hudTop`, `hudBottom`) matched what I guessed, so I pass them typed and nothing is needed there.
- **Me agent:** `/me` needs an `#earn` handler that opens the "Ways to earn" sheet. The streak chip links to `/me#earn`.
- **Event page agent:** deep links need the share button to build `…/?e=<eventId>`. Demo events now carry `swipes_in` and `here_now`, so going counts show in dev.

## Back end needed
None for what I built. Two things to know:
- Two drops can't be told apart per event by anything except `collectibleEventIds`. The "drops today" count relies on `useCollectibleEventIds`, which includes legacy non-expiring drops. The "drops today" line therefore counts events on the selected day that have any drop.
- The map now mounts `useGameDashboard`, which makes three Supabase calls (stats, leaderboard, score rules) every time the Map opens, just to read the streak. A slimmer streak-only read would be lighter.

## Screenshots
All under `/tmp/claude-0/-home-user-hoppaz-anchor-lab/3ba6225a-22c9-52f8-a623-caae67aa50f8/scratchpad/shots/map-chrome/`, each as `<name>-night.png` and `<name>-day.png`:
- `base`
- `sat`
- `sat-drag`
- `hopday`
- `kind-open`
- `kind-picked`
- `kind-pills`
- `locate`
- `empty`
- `deeplink`

Extras: `small320-day.png` and `desktop-day.png` (night versions of those weren't re-taken after the final edits); `logic-nextday-night.png`; and the production states `prod-error-night.png` and `prod-loading-night.png`.

Test scripts are in `…/scratchpad/tools/`: `map-chrome-flows.mjs`, `map-chrome-logic.mjs`, `map-chrome-views.mjs` and `map-chrome-prod.mjs`.

---

## build:map-canvas

The map canvas is rebuilt and checked in both night and day. Lint is clean on my files, and `tsc` shows no errors in them. The `EventCard.tsx` errors that appeared mid-run belong to another agent. The real CARTO basemap is blocked here, so I checked the basemap repaint against a synthetic Lagos basemap with CARTO-style layer ids and deliberately garish raw colours. No raw colour leaked through. Layer ids on the live CARTO styles are matched from memory, so give them one look once tiles load.

## Files changed
- `/home/user/hoppaz/src/components/map/NightMap.tsx` (rewritten)
- `/home/user/hoppaz/src/lib/mapStyle.ts` (rewritten)
- `/home/user/hoppaz/src/lib/busPosition.ts`
- `/home/user/hoppaz/src/app/globals.css` (only the MapLibre chrome, map signs, hover card, stops, bus and own-dot blocks; the `ts-*` title-sequence CSS is untouched)
- `/home/user/hoppaz/src/components/map/venueModels.ts` (new: the phase-4 no-op hook)
- `/home/user/hoppaz/src/lib/eventLots.ts` (deleted)
- `crowd.ts` is unchanged. `crowdLevel` and `TONE_HEX` are still exported because `EventCard` uses them.

## What I built, against the plan
- **3D city:** the extruded layer stays but is repainted neutral. Night ramps `#221A17` to `#2A2320` to `#3A302B`, day ramps `#E0D3C2` to `#CFC1AE`. It is simply there from zoom 13; `riseCity` is gone. A low style light keeps rendered roofs near the palette, and `repaint()` hides any basemap `fill-extrusion` building layer.
- **Sims lots:** removed. `mountVenueModels` and `updateVenueModels` in `venueModels.ts` are the named no-op hooks where the Campus Twin layer will mount.
- **Basemap:** roads and bridges are neutral hairline tones, with no orange. Night is dark-matter, or `NEXT_PUBLIC_MAP_STYLE` if set. Day is positron on cream. Theme changes while the map is open swap the style and rebuild every layer on `style.load`; I tested this live in both directions.
- **Markers:**
  - **Far out:** a dot plus a compact banner (name, then `PRICE · TIME` in DM Mono), restyled to the card, hairline and text tokens.
  - **From zoom 14.6:** the banner becomes a card with the flyer on top, or a branded fallback block (H mark plus vibe) when there is none.
  - **Declutter:** card, then banner, then price tag, then dot, by rank.
  - **Selected:** an orange 2px edge and ember lip, never a solid orange fill.
  - **Drops:** a violet `DROP` pill (border only) and a violet dot.
  - **Motion:** markers fade in at 160ms, no pop.
  - **Time label:** the time is `dayLabel` without the month, e.g. `SAT 18 · 10PM`.
- **Heat and ring:** heat fades out by zoom 14.5, runs ember to orange only, with no cream core and no halo. The radius ring is a thin dim hairline with no fill.
- **Camera:**
  - **Opening:** no swoop. The map opens flat and framed on the day's events, plus the Hop stops on Hop day, and re-frames if the page's chrome grows before anyone touches it.
  - **Select:** eases about 600ms to zoom 15 at pitch 40 (max pitch 45) with the dot landing so the card clears the top chrome.
  - **Deselect:** eases back flat.
  - **Bus button:** pans flat.
  - **Reduced motion:** gives zero-duration moves.
- **Bus and Hop:**
  - **Hop day:** a plain cream (night) or ink (day) dashed route, numbered card-colour stops, and a card-colour bus labelled `EST. · TO STOP 3`.
  - **Other days:** the bus parks up-left of stop 1 under `NEXT HOP · SAT 10`, which is tappable. There is no violet and no bob.
  - **Edge cases:** the bus hides when it would sit under the chrome, and the label flips sides near the right edge.
- **Crew faces:** gone. Your own position is a plain ring dot, only when `fix.source === "gps"`.
- **Hover card:** restyled with tokens, sits above every marker, and flips above the dot near the bottom chrome.
- **Credit:** a tiny mono line at bottom-left, just above the page's bottom chrome.

## Props
`page.tsx` already passes the extras under these exact names, so nothing is needed from the map-chrome agent.
- **New optional props:** `hopActive`, `hopDate`, `onBus`, `hudTop` and `hudBottom` (px the page's chrome covers; defaults 132 and 96).
- **Now optional:** `crew`, `myLook`, `play`, `busFocus`, `collectibleEventIds`. They are accepted but crew, `myLook` and `play` are ignored.
- **`BusFix`:** gained optional `hopDate`, `boarding` (stop 1) and `phase`, so the parked bus works even when the page passes no stops on non-Hop days.
- **Bug fixed along the way:** `.hz-stop` and `.hz-bus` had `position: relative`, which overrides MapLibre's absolute marker and drifts the stops off the route. I removed it.

## Needs from others
- `.env.example` and `README.md`: `NEXT_PUBLIC_MAP_STYLE` now applies to night only. README lines ~149-150 still describe buildings that grow out of the ground.
- The page's measured chrome decides what the map treats as free space. A bottom chrome that includes the "Post a flyer" row (about 200px) makes banners and the bus drop to dots in the lower strip.

## Back end needed
None. Real venue models (phase 4) are a client custom layer reading `public/venues/<id>.json`, and flyer photos need no new data.

## What I could not do
- Real CARTO tiles and layer ids could not be loaded here, as noted above.
- Flyer images were verified by injecting images into the cards, since no demo event has a `flyer_url`.

Screenshots are in `/tmp/claude-0/-home-user-hoppaz-anchor-lab/3ba6225a-22c9-52f8-a623-caae67aa50f8/scratchpad/shots/map-canvas/final/`, each in `-night` and `-day`:
- `far`
- `zoom`
- `flyer`
- `select`
- `deselect`
- `gps`
- `swap-before` and `swap-after`
- `hopday-or-today`, `sat`, `sun` (parked bus on non-Hop days, route on the Hop day)
- `moving`
- `desktop` (hover card)

My harness is the `map-canvas-*.mjs` files in `scratchpad/tools/`.

---

## build:event-page

## Report: event-page surface

`tsc --noEmit` is clean, and eslint is clean on every file I own. I screenshotted in both `?theme=night` and `?theme=day`, and the sheet also renders correctly on the Today screen and at desktop width. A few paths I could not run for real: the error toast on a failed "I'M GOING", an ended event, and live Supabase. They are straightforward code but untested.

The workflow-config part of your request (setting the builders to Opus 5 or Sonnet 5.5 at ultracode) is not something I can change from inside this task. I only built my surface.

### Files changed
- `src/components/EventCard.tsx` (rebuilt; keeps its props, adds optional `checkedAt`; `radiusKm` is now optional and unused)
- `src/components/EventQuestList.tsx` (rebuilt; adds optional `onAddPhoto` and `uploading`)
- `src/components/HopSheet.tsx` (rebuilt)
- `src/components/QrScanner.tsx` (restyled; now renders into `document.body`, because the stub's mask would clip a fixed overlay)
- `src/lib/useCheckin.ts`: `checkIn` now returns an outcome `{ ok, at, xp, badges }`. The hook also returns a `checkedAt` map. It stops toasting success; failures use the error tone and sentence-case copy.
- `src/lib/useEventFeed.ts`: chat fetch removed; `upload` returns `{ ok, message }`.
- New: `src/components/event/` with `StubSheet`, `ArtPanel`, `GoingFoot`, `CheckInBlock`, `DropRow`, `Photos`, `copy`, `share`, `useMyLook`, `demo`.

### What I built, against the plan bullets
- **One tall sheet, built as a stub.** `StubSheet` is a shared sheet used by the event page and the Hop. It is about 85% tall, with a grab handle (drag down to close), a hairline top edge, `animate-rise`, and the notches. The stub colours follow `themeForEvent(starts_at)`. Close is 44px and Escape closes it.
- **Pinned footer.** The guest list, the going button and the secondary row sit under a dashed perforation, and the notches sit on that line, so they are always in reach. Everything else scrolls above.
- **Art panel.** The flyer shows whole, centred on a blur of itself, and tapping opens it full size. With no flyer you get a calm strip with the vibe and the wordmark.
- **Title block.** The title is Poppins Black 30px, followed by one cream mono line (`TODAY · 10PM · LEKKI · ₦10,000`, with `TIME TBC` for leads). The venue is in Archivo. At most one pill is shown: a violet drop pill (`DROP AT 11PM` or `DROP LIVE`), otherwise a danfo `UNCONFIRMED` for leads, otherwise a lagoon `DAYTIME`. Hop stops get a plain "ON THE HOP ROUTE" line.
- **Guest list.** A big Poppins Black going count with "HOPPERS GOING", your face, and "N HERE NOW" only while the event is live. Your tap changes the count immediately. Crew faces are a marked TODO in `GoingFoot.tsx`.
- **I'M GOING.** It uses `useGoing(userId).toggleGoing`. On success the button stamps to a keke-bordered "YOU'RE GOING" (tap again to undo) and your face stamps into the list. On error you get an error toast and the button stays orange.
- **Secondary row.**
  - SHARE uses `navigator.share` with `/?e=<id>`; the fallback copies the text and link and toasts "Link copied".
  - TICKETS shows when `ig_url` is a ticketing link, and LISTING when it is an Instagram link.
  - EVENT CHAT links to `/chat?c=<id>`.
- **Check-in.**
  - The button reads "CHECK IN", and a disabled "CHECK-IN OPENS AT THE VENUE" shows when you are far. The strip is hidden for events weeks away unless you are at the venue.
  - On success a keke "CHECKED IN · 3:16PM" stamp lands on the stub, with one stamp per badge.
  - The stamp scrolls into view above the footer.
- **Quests.** Only this event's quests show, one line each with the reward. A form opens when you tap that quest, and photo and check-in quests stay folded behind a lock until you check in. All icons are line icons.
- **Drop.** One row with a violet dot: "A drop is hidden here · open it at the venue". When you are close it becomes a lip button, `OPEN DROP`, that runs the existing claim and collect calls. The result lands as a small stamped card with collectible art if present. Violet is only ever the dot and the pill border. Drops you already opened (from `my_drop_claims`, or this session) stop showing as hidden.
- **Photos.** The section shows only when approved photos exist, titled "PHOTOS FROM THE NIGHT". "ADD A PHOTO" is a small link shown only after check-in. "No pictures yet" is gone.
- **Cut.** The "How the night goes" chart, the three stat tiles, the source label (kept as a one-line hint for leads), the tag row, the chat preview, the 1.5 km footnote, "+50 XP" on buttons, and all emoji. The only XP numbers left are quest rewards and a plain "+N XP" next to a fresh check-in stamp, using the server's real figure.
- **HopSheet.** It is a stub with "THE HOP" and a mono line for date (Lagos time) and price, then "BOARD AT …" on its own line. Stops hang on a vertical route line with mono times and hairline dots, the last one solid. There is one sentence of copy, a "GET A SEAT" lip button, and "HOP CHAT" as a text link. No violet fills.
- **QrScanner.** The title is the neutral "Scan the venue code", the close button is 44px, and the error is fireant ("…or type the code") with a "TYPE THE CODE" button. The viewfinder corners are cream. Escape closes only the scanner.

### What I could not do, and deviations
- **Sample data for dev.** There is no database locally, so the sample quests, a sample drop, flyers and photos exist in `event/demo.ts`. They only appear on `demo-` event ids, which exist only in development. The local demo check-in also returns sample badges.
- **Honest check-in.** With Supabase present but no session yet, check-in no longer pretends it worked. It now says "Still connecting" instead of faking success.
- **EVENT CHAT is a link.** The plan's "EVENT CHAT · N talking" line is not built; see back end needed.
- **Toasts over the footer.** The global toast sits above the nav and can cover part of the pinned footer for 3 seconds. That is the Toaster's position, which I don't own.

### Needs from others
- `src/app/page.tsx`: take `checkedAt` from `useCheckin(...)` and pass `checkedAt={checkedAt[event.id] ?? null}` to `EventCard`. `src/app/discover/page.tsx` already does this. Without it the stamp keeps its time for the rest of the session but loses it after a reload.
- The Today screen and the map both render the sheet as an `absolute` overlay in a `relative` container, which works as is.

### Back end needed
- **Crew faces on the guest list.** Needs an RPC returning crewmates' avatars who said going or RSVP'd for an event id (TODO in `GoingFoot.tsx`).
- **"N talking" for event chat.** Needs a recent distinct-author count for the event room.
- **Lineup.** There is no lineup field, so the section is not built.
- **WhatsApp preview card.** Needs a small server-rendered per-event page. Today the share link opens the map with `?e=`.
- **Reveal screen for drops.** The stamped result card is a stand-in until it exists.

### Screenshots
All under `/tmp/claude-0/-home-user-hoppaz-anchor-lab/3ba6225a-22c9-52f8-a623-caae67aa50f8/scratchpad/shots/event-page/final/`:
- **Night:**
  - `demo-12-night-default-1.png`
  - `demo-12-night-going-1.png`
  - `demo-6-night-checkin-1.png`
  - `demo-5-night-nofly-1.png`, `demo-5-night-nofly-2.png`
  - `demo-12-night-drop-1.png`, `demo-12-night-drop-2.png`
  - `demo-12-night-quest-1.png`, `demo-12-night-quest-2.png` (quest open, then the QR scanner)
  - `hop-night.png`
- **Day:**
  - `demo-2-day-flyer-1.png`, `demo-2-day-flyer-2.png`
  - `demo-1-day-live-1.png`
  - `demo-3-day-stamp-1.png`
  - `demo-12-day-going-1.png`, `demo-12-day-going-2.png`
  - `hop-day.png`
- **Extras** in `…/shots/event-page/`:
  - `lead-night.png`
  - `links-day.png`, `links-night.png`
  - `lightbox.png`
  - `dragging.png`
  - `today-card-night.png`
  - `desktop-night.png`
  - `share-toast.png`
- **Playwright scripts:** the `event-page-*.mjs` files in `scratchpad/tools/`.

---

## build:today

The Today tab is rebuilt and I checked it in night and day screenshots. `tsc --noEmit` and `eslint` on my files are clean, and there were no console or hydration errors on `/discover`. I couldn't visually check the production "can't reach events" state, because the dev server always has sample data.

## Files changed
- `src/app/discover/page.tsx`: rewritten.
- `src/components/SwipeDeck.tsx`: rewritten.
- `src/components/HeatBar.tsx`: deleted. Nothing else imported it. Restore it if you'd rather keep the file.
- New files in `src/components/today/`:
  - `EventStub.tsx`: the stub, plus `GhostStub`.
  - `YourDays.tsx`
  - `Empty.tsx`: `EmptyDay`, `FilteredOut`, `NextBusyLine`, `LoadFailed`.
  - `helpers.ts`: pure helpers for the conductor line, the one-pill rule, the mono fact line and the next-busy-day lookup.
  - `useEventQuests.ts`

## What I built, against the plan
- **Header:** Poppins Black "Today", or the weekday plus a quiet date ("Friday 9 OCT") on other days. Under it is the cream conductor line, e.g. "8 Hoppers out. Drops at 1 spot." and "110 Hoppers going. Drops at 1 spot." on a future day.
  - Today it counts check-ins first (`here_now`), then falls back to going counts. The drops part uses `useCollectibleEventIds`, the same hook and demo rule as the Map, and is left out when there are none.
  - The MAP button and the shrinking "{n} events" are gone.
- **Day picking:** the full-size `DayRail` shares the store's `dateFilter` and uses the same typed counts as the Map's rail. The native "Pick a date" input and the old chip row are gone. Past days snap back to today, as on the Map.
- **Type filter:** active vibe types show as removable orange chips ("AMAPIANO x") with a "Clear" link.
- **YOUR DAYS:** a strip of small stubs for events you're going to in the next 14 days, soonest first, built from `useGoing` decisions and loaded events. It shows only when there is something. Tapping opens the event. It replaces the old "You said you are in" footer and the "YOU ARE IN" toast.
- **Main list:** ticket stubs for the selected day, most going first, then earliest start, including events you've swiped before.
  - Each stub wears its own event's colours (`stub-day` or `stub-night`) and sits under a punched perforation.
  - Top to bottom: flyer on a soft blur (calm branded strip with the wordmark when there's no flyer), title in Poppins Black, and one mono line "dayLabel · AREA · PRICE".
  - Leads print "TIME TBC · AREA · CHECK LISTING", matching the event page.
  - A "QUESTS HERE" line shows only when the event has quests, with titles and the XP total.
  - At most one coloured pill: DROP, then UNCONFIRMED, then DAYTIME, then "N GOING" (hidden at 0). When the pill isn't the going one, the count shows as plain dim text next to it.
- **I'M GOING button:** it saves through `useGoing.toggleGoing`. On success it stamps to a keke "YOU'RE GOING" with your own face and plays `animate-stamp`, only on your tap and never on page load. Tapping again undoes it. A failure shows an error toast and the button stays orange.
- **Going counts:** your own tap adds one to the shown count until a fresh load brings the real number. Changing going inside the event page is folded in when the page closes (verified: 17 became 18).
- **Opening an event:** tapping anywhere on the top of a stub opens the existing `EventCard` over the list. I pass `checkedAt` as well as the current props, and use `useCheckin` and `useHop` as the Map does.
- **Swipe mode:** a quiet "Can't decide? Swipe" text button in the header, which turns into "Back to the list". It only deals the events you haven't decided on.
  - Cards are compact stubs: title, one mono line, one pill (never the going pill) and the going count as a big number.
  - `HeatBar` and the 8-fact grid are cut.
  - The stamp reads GOING in a keke border (NAH on the left swipe), at the `animate-stamp` timing: 180ms, no bounce, a degree off square.
  - Controls are NAH, info and I'M GOING. Info opens the same `EventCard`.
  - Saves go through `useGoing.decide`. A failed save brings the card back with an error toast.
  - The drag instruction shows only until your first swipe (localStorage flag).
  - When the deck runs out you get "That's the lot." with a "BACK TO THE LIST" button.
- **Empty day:** the mascot asleep (120px), "Quiet one.", the orange button "NEXT BUSY DAY · TUE 13 · 1 ON", and a quiet "Post a flyer" link to `/drop`.
  - If a type filter is what's hiding everything, you get plain words ("Nothing on for that.") with "CLEAR THE FILTER" and no mascot.
  - Days with 5 or fewer events end with a plain text line pointing to the next busy day.
- **Loading and failure:** until the first load finishes there are two static ghost stubs and "Checking what's on…", never an empty state. If production can't reach events, you get a one-line fire-ant error with "Try again".
- **Copy:** "going" everywhere, no emoji, no em dashes (checked with a grep).

## What I couldn't do, and why
- **Mascot on cream:** `Mascot.tsx` draws a cream body, which disappears on the cream day ground. I switch to the ink edge on the day theme inside `Empty.tsx`.
- **Drop pill wording:** it says plain "DROP" rather than "DROP AT 11". The drop time isn't available without a per-event `game_drops` query.
- **Production empty/failed state** (see top).

## Needs from others
- `src/components/Mascot.tsx` (foundation): make the day theme use the ink edge by default, so every other surface that uses the mascot on cream doesn't lose its body.
- `src/components/event/demo.ts` (event-page agent): I import `demoQuests`, `isDemoEvent` and `demoFlyer` from it, so the stubs match the event page in development. Keep those exports.
- Map `src/app/page.tsx` (map agent), optional: pass `checkedAt={checkedAt[event.id] ?? null}` to `EventCard`, as I do.

## Back end needed
- Crew faces on a stub (the event page already carries the TODO).
- A drop's open time, to print "DROP AT 11".
- Per-event quests only show once quests have an `event_id` set. City-wide quests are deliberately not listed here.

## Screenshots
All under `/tmp/claude-0/-home-user-hoppaz-anchor-lab/3ba6225a-22c9-52f8-a623-caae67aa50f8/scratchpad/shots/today/final/`, each in `-night.png` and `-day.png`, except `swipe-info`, which is day only:
- `list` (390x1900 tall)
- `going`
- `types`
- `empty`
- `filtered`
- `friday`
- `swipe`
- `stamp-going`
- `stamp-nah`
- `lot`
- `event-open`
- `ghost` (the server-rendered loading state)
- `swipe-info`

The earlier "before" shot is in `shots/today/before/`. The driver script is `scratchpad/tools/today-flow.mjs`.

---

## build:me

FINAL REPORT: ME tab and game layer screens. Typecheck and ESLint on my files are clean, and no console or hydration errors showed in any screenshot run.

## Files changed
- `/home/user/hoppaz/src/app/me/page.tsx` (rewritten)
- `/home/user/hoppaz/src/app/quests/page.tsx` (now a server `redirect("/me#earn")`)
- `/home/user/hoppaz/src/app/drops/page.tsx` (rewritten)
- `/home/user/hoppaz/src/app/collection/page.tsx` (rewritten, titled "Your shelf")
- `/home/user/hoppaz/src/lib/brand.ts`
- `/home/user/hoppaz/src/lib/game.ts`
- `/home/user/hoppaz/src/lib/useCollectibles.ts`
- New files in `/home/user/hoppaz/src/components/me/`:
  - Screen pieces: `MeHeader`, `NumberTiles`, `BadgeShelf`, `StampMark`, `WaysToEarn`, `YourNights`, `SettingsGroup`, `Rows`, `SubHeader`, `PerforatedStub`, `Serial`, `SpotMascot`.
  - Helpers: `dropTime.ts`, `seen.ts`, `useNow.ts`.
  - Dev sample data: `demo.ts`.

## What I built, mapped to the plan
- **Header:** the avatar links to `/me/avatar` and carries a small dress icon. The name sits above one big level name in Poppins Black. A mono label under it reads "HOPPER · N STAMPS", or "CAPTAIN" at 4 Hop badges. The 72px mascot sits on the right.
  - **Mascot:** it sleeps if the last check-in is more than 14 days ago or there is none. It celebrates if the last check-in is within 7 days and the daily streak is 2+. Otherwise it idles. It waves once on the first open of each Lagos day (localStorage), then drops to its normal state.
  - **Day-theme edge:** the ink edge on cream is done in CSS off `data-theme`. A `useTheme`-driven `edge` prop caused a hydration mismatch.
- **Two number tiles:** DAILY STREAK and XP, both 44px Poppins Black with a mono caption.
  - **Orange tile:** the one that moved since your last visit is orange and stamps in once; if both moved, the streak wins. Moves are remembered per phone, and the level name stamps in when the level changes.
  - **XP tile:** tapping it, or visiting `/me#earn`, opens the "Ways to earn" Sheet. I checked a direct load, a client-side push to `/me#earn`, and `/quests` redirecting to it. Closing the sheet clears the hash.
- **Ways to earn sheet:**
  - A level progress line at the top.
  - The loaded quests, each with title, `+XP`, repeat period, and event name if tied. The event name comes from one light lookup of the tied events.
  - A fixed "Always earns" list: check in, photo after check-in, finish a quest, claim a drop.
  - It only mounts and loads while open.
- **Badge shelf:** a compact horizontal shelf of punched `.stub`s, earned first, then locked.
  - **Earned:** a drawn stamp (lucide icon in a one-colour double ring, a few degrees off square), the name, and the earned date in DM Mono.
  - **Locked:** a dashed outline with its how-to-earn line.
  - **Details:** tapping any stub opens a small sheet. Newly earned badges stamp in once, but not on a phone's first visit.
  - **Badge source:** badges that exist only in the database use the generic Stamp icon, never their emoji.
- **Rows:**
  - **Month report card:** the make-report action moved here from `/quests`. It copies the link and toasts "Link copied."
  - **Live drops:** links to `/drops`, with a live-now count.
  - **Your shelf:** links to `/collection`.
  - **Birthday ask:** it is now a plain card, not an orange-bordered one.
- **Your nights:** a quiet list with a mono date, five rows and then a "SHOW ALL" link, no orange decoration.
- **Settings:** a collapsed group with name (inline edit), home area, account, replay intro, privacy, community rules, STAFF (only when `is_admin`), and "Delete my account" in fireant with an inline two-step confirm replacing the native `confirm`. The offline line now reads "You're offline. Your nights will save when you're back."
- **Removed:** the Outside Score box, the Lagos rank pill, the duplicate "Your look" card, the Captain card, the "ladder" paragraph, the orange and violet tinted panels, and the orange diamonds.
- **`brand.ts`:**
  - **Levels:** `LEVELS` are now JJC, REGULAR, PLUG, OGA, AGBA with the same thresholds, and a comment marks the names as pending Jae's sign-off.
  - **Badges:** `BADGES` use lucide icon names instead of emoji, with keys, names and how-lines kept. I renamed "Flyer drop" to "Flyer poster" ("Post a flyer that goes live"), since "drop" should mean rewards only.
  - **Helpers:** I added `statusFor()`, `CAPTAIN_HOPS` and `levelFor().toNext`.
- **`/drops`:** a punched stub per drop, split into OPEN NOW and COMING UP.
  - **Sealed:** a "SEALED" pill and a disabled DM Mono button reading "OPENS IN 2H 14M" within 12 hours, otherwise "OPENS FRI 10PM". It ticks every 15 seconds.
  - **Open:** a CLAIM lip button and a "CLOSES 23:30" pill, turning danfo in the last hour.
  - **Closed:** closed drops leave the list.
  - **Violet:** the violet dot is dropped when the danfo pill shows, to keep one tier-2 colour per card. No violet fills anywhere.
  - **After claiming:** a "YOU GOT" block with the reward, a serial-style code and a COPY button. Drops you already claimed show a CLAIMED pill and link to the shelf.
  - **Empty:** the "secret" mascot, "No drops live. They land at the venue.", and a SEE TONIGHT button.
  - **Wording:** the random/fixed wording is gone.
- **`/collection`:** collectible stubs show `art_url` full-bleed, or the emoji inside a fixed 64px frame when there is no art. Claimed rewards are perforated stubs: Poppins Black name, partner and date in mono, and the code printed as a serial with a COPY lip button. The empty state uses the "oya" mascot.
- **Fonts and copy:** descriptive text is Archivo, labels are DM Mono, and nothing in my files is under 10px. My files have no em dashes or emoji, apart from `\u{...}` escapes in the dev sample data.
- **Shared hooks:** `useQuests`, `useGameDrops` and `useGameDashboard` now also return `ready`, so screens never say "empty" before data arrives. `useGameDashboard(userId, { lite: true })` skips the leaderboard and score-rule queries (Me uses it). Both changes are additive.
- **`useCollectibles.ts`:** I exported the `CollectionEntry` type.
- **Dev demo mode:** with no Supabase keys and `NODE_ENV !== "production"`, Me, Drops and the shelf show sample content so they are reviewable. Adding `?empty` shows the empty states. In production without keys, none of it appears.

## What I could not do, and why
- **Captain at 4 Hop badges can't be reached yet.** The `badges` table has a primary key on `(user_id, key)` and `award_badge('hop')` is idempotent, so a Hopper can hold the "hop" badge only once. I coded Captain as 4 badge keys equal to `hop` or starting with `hop-`/`hop_`, so it works the day per-Hop badge keys exist.
- **Live-data paths are untested.** The real Supabase flows (claim, make report, delete account, quest names) could not run here, so I only verified them by reading the code and in demo mode.
- **Account and STAFF rows are unverified in the browser.** They need a live session or `is_admin`.
- **The mascot still looks like a rabbit.** That is the `Mascot` component as given, and it is open item 2 in the plan ("no rabbit face" rule).

## Needs from others
- `/privacy` (not mine) still has "Owner notes". Plan item: contact itshoppaz@gmail.com, controller Hoppaz.
- `/me/avatar/page.tsx:348` still uses `text-[8px] text-orange` for a non-tappable brand label.
- `BottomNav.tsx` still lists `/quests` in its `PARENT` map. This is harmless because the page redirects.
- The map's streak chip should link to `/me#earn`. Client-side push to that URL opens the sheet, as tested.
- Tonight's conductor line can use the live-drop count from `useGameDrops()`.

## Back end needed
- **Per-Hop badge keys**, so Captain (4 Hop badges) is reachable.
- **Badge icons:** quest badges in `badge_catalog` have emoji icons and no art. They use the generic stamp until an `art_url` or icon key column exists.
- **Month report card:** the rank belongs on the card (the plan says it can appear there), but `my_game_stats` is the only source. `create_monthly_report` snapshots it, and `lagos_rank` can be 0 or empty.
- **Rewards without a code** (`my_drop_claims` returns `code: null`): the shelf shows the stub without a serial. A "collected_at" for physical rewards would help.

## Screenshots
Everything in `/tmp/claude-0/-home-user-hoppaz-anchor-lab/3ba6225a-22c9-52f8-a623-caae67aa50f8/scratchpad/shots/me/final/` (390x844 or taller phone width, night and day versions of each):
- `me-night.png`, `me-day.png`
- `me-earn-night.png`, `me-earn-day.png` (Ways to earn sheet)
- `me-badge-sheet-night.png`, `me-badge-sheet-day.png`
- `me-settings-night.png`, `me-settings-day.png`
- `drops-night.png`, `drops-day.png`
- `drops-empty-night.png`, `drops-empty-day.png`
- `collection-night.png`, `collection-day.png`
- `collection-empty-night.png`, `collection-empty-day.png`

Extra states, night only, in `.../shots/me/`:
- `me-empty-night.png` (sleeping mascot, no stamps)
- `me-mood-wave-night.png`, `me-mood-celebrate-night.png`
- `drops-claimed-night.png`, `drops-copied-night.png`
- `me-badge-locked-night.png`, `me-badge-earned-night.png`, `me-delete-night.png`

My Playwright scripts are `me-tall.mjs` and `me-flow.mjs` in `.../scratchpad/tools/`.

---

## build:appwide

All of the appwide surface is built and checked in both themes. `npx tsc --noEmit` and `npx eslint` on my files are clean. I changed no git state and ran no `npm install`.

## Files changed
- `src/app/privacy/page.tsx`, `src/app/community/page.tsx`, `src/app/account/page.tsx` (styling only)
- `src/app/report/share/[token]/page.tsx` is now a small server page. It adds a noindex robots tag and a title, then renders the new poster component.
- `src/components/TitleSequence.tsx`
- `src/app/layout.tsx` mounts `<OfflineLine/>` and `<InstallSheet/>`.
- `src/app/globals.css`: the title sequence block is rewritten, and a new "app-wide states" block is appended at the very end.
- New: `src/app/not-found.tsx`, `src/app/error.tsx`, `src/app/global-error.tsx`
- New in `src/components/app/`: `PageHeader`, `LoadingStub`, `EmptyState`, `ErrorState`, `OfflineLine`, `InstallSheet`, `ReportPoster`

## What I built, against the plan
- **404 and crash pages:** the mascot in "oops", one line, and a lip "BACK TO TODAY" to "/".
  - 404 says "That page has gone home."
  - The crash pages say "Something broke on our side." and add a ghost TRY AGAIN.
  - They follow Next 16.4's docs: `error.tsx` and `global-error.tsx` use the `retry` prop, not the old `reset`.
  - `global-error.tsx` brings its own html, fonts, CSS and theme.
  - I added a small mono label on each ("404 · WRONG STOP", "OUR SIDE · NOT YOURS"). Tell me if you want it gone.
- **Shared kit:**
  - `PageHeader`: tab pages get a big title, no back; sub-pages get a 44px chevron and at most one `action`. The chevron uses `router.back()` only when there is a same-site entry to go back to (Navigation API), otherwise the fallback href. An optional `backTo` prop forces one destination, which the Account page uses.
  - `LoadingStub`: static ghost stub, no shimmer.
  - `EmptyState`: mascot asleep, one line, one action.
  - `ErrorState`: mascot in "oops", a Fire Ant line, TRY AGAIN.
  - All are documented in JSDoc.
- **Offline line:** "No signal. Showing what we had." sits in the layout column under the status bar and goes when you are back online. While it shows, `<html>` carries `hz-offline` and `.pad-top` drops its safe-area padding, so nothing doubles up. It also fires a window `resize` so the map re-measures.
- **Install sheet:** I tested it with spoofed user agents.
  - iPhone Safari: the mascot in "oya" with two steps ("Tap Share", "Then Add to Home Screen") and line icons.
  - Android Chrome: captures `beforeinstallprompt` and fires the real prompt from a lip "ADD TO HOME SCREEN". Accepting stores `done` and it never shows again.
  - Timing: it shows 1.4s after the event, fixed above the tab bar. After the first going event, "Not now" or X, a later going event does nothing. The first-checkin event shows it once more, then never again. State is kept in localStorage key `hoppaz.install`.
  - It stays quiet on desktop, inside the installed app, in iOS in-app webviews, and on `/report/` and `/admin`. Where it can offer nothing it keeps its chance for later.
  - `FIRST_CHECKIN_EVENT = "hoppaz:first-checkin"` is exported from `InstallSheet.tsx`.
- **Privacy:** Poppins Black headings, Archivo 15px in cream. Owner notes are removed, and a "Who we are" line names Hoppaz as controller. Contact is `NEXT_PUBLIC_SUPPORT_EMAIL`, falling back to itshoppaz@gmail.com. Back returns to the previous screen.
- **Community rules:** numbered 01 to 05 in DM Mono, same type setup, same back behaviour.
- **Shared report poster:**
  - Layout: always the night ground, with the wordmark, a tilted "TEMI WAS OUTSIDE." with a hard ember shadow, and the month in DM Mono.
  - Numbers: one orange hero number (nights out, from `verified_outings`) and the week streak (from `outing_streak`) in a ticket stub with a perforation. "#12 IN LAGOS" appears as a cream sticker only when a rank exists.
  - Mascot: "celebrate" with `edge="ink"` on a torn cream scrap, plus faint grain.
  - Action: one big "OPEN HOPPAZ" lip button.
  - Fitting: the name size scales to fit long names and the number shrinks at three digits.
  - Bad links: a bad or expired link, an RPC error, or no data shows the mascot in "oops" and "This report has expired." instead of loading forever.
  - Same RPC, no new data. For local testing, `/report/share/demo` shows a sample poster in development only.
- **Title sequence:** START 0.3s + PAN 3.4s + 0.8s hold is 4.5s in all.
  - The TSX hands `--ts-start` and `--ts-pan` to the CSS, and the CSS fallbacks match, so they cannot drift.
  - A tap anywhere skips it; double-firing is guarded.
  - Every elastic curve is replaced with a quick hard ease-out stamp. The infinite star twinkle is gone.
  - It ends on the wordmark, then the tagline, then the mascot in "welcome" underneath.
  - It is forced to the night set so it no longer breaks by day.
  - Reduced-motion users still skip it.
  - I made two art calls: the violet moon is now a quiet cream disc, since violet is reserved for drops, and I shortened the scene so the last tower and its sign are fully in frame at the end.
- **Account page:** the shared header, chips with `aria-pressed`/`aria-checked` instead of lip buttons and pills for the mode and gender toggles, Fire Ant errors, and a stub loading state. No logic changes.

## Foundation fix to know about
- The mascot's cream body vanished on the cream day ground, because its keyline was the ground colour. I added `[data-theme="day"] svg.rig { --rig-edge: #0e0b0a }` at the end of `globals.css`, so by day it gets the ink sticker edge everywhere. `Mascot.tsx` is unchanged; you may prefer a day-aware default in the component instead.
- I also added `.hz-link` (orange at night, ember by day so it passes contrast), `.hz-night` / `.hz-poster` (forced night tokens), `.hz-grain` and `.hz-scrap`.

## Not verified
- `global-error.tsx` has not been seen rendered. It type-checks and lints, but it only appears when the root layout itself throws and I did not want to break the shared layout to test it.
- A theme override via `?theme=` is lost when a page crashes during server rendering, because the boot script never runs. The Lagos clock still picks the right theme for real users.

## Needs from others
- **`src/lib/useCheckin.ts`:** on the first successful check-in, in both the demo path and the real path, right before each `return { ok: true, ... }`, add this. It needs `import { FIRST_CHECKIN_EVENT } from "@/components/app/InstallSheet"`.
  ```ts
  try { if (!localStorage.getItem("hoppaz.firstCheckin")) { localStorage.setItem("hoppaz.firstCheckin", "1"); window.dispatchEvent(new Event(FIRST_CHECKIN_EVENT)); } } catch {}
  ```
- **`src/lib/useGoing.ts`:** in `decide`, the `if (!sb) { setDecision(...); return null; }` branch returns before the first-going dispatch. So demo mode never shows the install sheet. Dispatch `FIRST_GOING_EVENT` there too when `decision === "in"`, using the same `FIRST_GOING_KEY` guard.
- **Chat and `PersonCard`:** link "community rules" (`<Link href="/community" className="hz-link">`). The audit asked for this and I do not own those files.
- **Other screens:** can adopt `PageHeader`, `EmptyState`, `LoadingStub` and `ErrorState` from `@/components/app/*`. For example, Crew should show `LoadingStub` while `useCrew` is loading.

## Back end needed
- Per-link WhatsApp preview (Open Graph image and title for the report) needs a server-side token lookup. I only added noindex and a plain title and description.
- "Where you went and who with" on the report is not in the saved snapshot.
- "Save to story" and WhatsApp image export for the poster are not built (not requested here).

## Screenshots
All in `/tmp/claude-0/-home-user-hoppaz-anchor-lab/3ba6225a-22c9-52f8-a623-caae67aa50f8/scratchpad/shots/appwide/`:
- Pages, night and day: `_privacy-*`, `_community-*`, `_nope-*`, `_account-*`, `_report_share_demo-*`, `_report_share_bad-*`, `error-*`
- Poster edge cases (long name, one night, three digits, no rank): `poster-variants.png`, `poster-variants2.png`
- Kit components, night and day: `_hz-kit-night.png`, `_hz-kit-day.png`
- Install sheet, night and day: `install-ios-*`, `install-android-*`, `states-day-sheet.png`
- Offline line, night and day: `offline-*`
- Title sequence frames: `title-night-sheet.png`, `title-day-sheet.png`

My test scripts are `appwide-*.mjs` in `/tmp/claude-0/-home-user-hoppaz-anchor-lab/3ba6225a-22c9-52f8-a623-caae67aa50f8/scratchpad/tools/`.
