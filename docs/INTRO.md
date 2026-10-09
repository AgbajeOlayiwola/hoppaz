# Paz's first-run tour

The gamified setup Jae approved (DECISIONS.md, "Gamified first-run setup"): Paz the Conductor walks a new Hopper round the real screens. This note is the contract for the module and the exact wiring list. The module is built and reviewable on its own at `/dev/intro`, and it is wired into the app (see "Wired" at the end).

## What was built (all new files)

| File | What it is |
|---|---|
| `src/lib/intro/steps.ts` | Step ids, order, per-step data (mascot state, targets, button, route), event names, `data-intro` target names |
| `src/lib/intro/lines.ts` | Every line Paz says, in one place. `HAS_CARDS` flips "a collectible" to "a card" |
| `src/lib/intro/machine.ts` | Pure logic: what applies, what is already true, the current step, events as facts, skip, pause, replay |
| `src/lib/intro/store.ts` | Zustand store, localStorage save per user, the event bus: `introEvent`, `introSkip`, `introReplay` ... |
| `src/lib/intro/mirror.ts` | Mirrors "tour done" to a profile flag, only if the profiles row already has such a column |
| `src/lib/intro/actions.ts` | What the orange button does (install, locate, alerts, send_avatar), each with a working default and `registerIntroAction` to replace it |
| `src/lib/intro/bridges.ts` | Turns events the app already emits into tour events (Play enter and exit, welcome-done, open stage, location, appinstalled) |
| `src/lib/intro/view.ts`, `env.ts`, `index.ts` | Card content per situation, device reads, barrel |
| `src/components/intro/IntroHost.tsx` | The overlay. Mount once. |
| `src/components/intro/IntroCard.tsx`, `useSpotlight.ts`, `intro.module.css` | Paz and her card, the ring and arrow, the geometry loop |
| `src/components/intro/ReplayTourRow.tsx` | The "Replay the tour" row for Me |
| `src/app/dev/intro/` | Dev-only review page (404 in production) |

No table was added. The wiring below edits existing files; "Wired" lists what was done.

## The steps

Which step shows is derived, never stored: the first step that applies to this Hopper, has not been seen or skipped, and is not already true. So the Hopper can get ahead of Paz (tap their face before she asks) and she simply moves on.

| # | id | Paz says (short) | Needs | Done when |
|---|---|---|---|---|
| 1 | `welcome` | Oya, welcome! Every dot is something to do | the map is up (`map_ready`) | button |
| 2 | `install` | Keep me close: home screen | target `install` | button (opens the install sheet), or already installed |
| 3 | `locate` | Let's find you | target `locate` | `location_granted` or `location_denied` |
| 3b | `no_location` | No wahala. Boxes need your location | only if refused | button |
| 3c | `outside` | Ah, you're far! | only if outside Lagos | button |
| 4 | `face` | Tap your face | target `avatar` | Play entered |
| 5 | `box1` | Free boxes! Tap the first | Play, target `box` | 1 box opened |
| 6 | `box2` | Lucky you! Next box | Play, target `box` | 2 boxes opened |
| 7 | `box_far` | That one's far. Send your avatar | Play, target `far-box` | `welcome_done` |
| 8 | `spawns` | Boxes drop all day and stay open a while (no number: the spawn rules set the life, staff tune it), wave, vibe, link up | Play | button |
| 9 | `alerts` | Want a ping? (iPhone not installed: add me first) | target `alerts` | alerts on or refused, or already granted |
| 10 | `leave_play` | Back to the street | target `play-exit` | Play closed |
| 11 | `deck_go` | Tap Today | target `today-tab` | the deck is on screen |
| 12 | `deck` | Slide and tap (compact Paz, Today keeps room for the card) | route `/discover`, target `deck` | an event opened |
| 13 | `chat` | Every event has a chat (compact Paz, so the event sheet stays readable) | target `event-chat` on screen | chat opened |
| 14 | `crew_go` | Tap Crew | target `crew-tab` | Crew on screen |
| 15 | `crew` | Crew up: how crews work | route `/crew` | button |
| 16 | `me_go` | Tap Me | target `me-tab` | Me on screen |
| 17 | `me` | You're set. We outside! | Me | button, then the tour is done |

Rules baked in:

- Every step has a small Skip (top right of the card). Skip saves progress. Skipping `face`, `deck_go` or `crew_go` also skips the steps that make no sense alone. Skipping `locate` parks the box part (see below).
- "End tour" (bottom left of the card) hides the tour and brings it back about 20 hours later from the next unseen step. After three of those it stops for good.
- Location refused or skipped: the box part (`face` to `leave_play`) leaves the tour and it carries on with events. The Hopper is asked again later: wiring fires `location_needed` when Play or a box needs location and it is off, and Paz shows "Boxes need your location". When location comes back the tour picks the box part up again, even if the tour had finished.
- Outside Lagos: a friendly line (`outside`), then the events part only. Decided from the position: `location_granted` with `{ lat, lng }` outside the Lagos box, or `outside_lagos`.
- Replay (from Me): everything again from the top. Box steps get a plain button because the welcome boxes are already open. Location and install state stay (they belong to the device).
- The card hides while any sheet, the open stage, the title sequence or the sign-up sheet is up (any `[role="dialog"]`), and comes back 450 ms after the last one closes. A dialog that contains the spotlight target does not hide it (the EVENT CHAT link lives in one). It also hides for the whole of a box open (`open-start` to 700 ms after `open-done`), so it can never sit on the Play open moment.
- The layer ignores taps. Only the card takes them, so the thing Paz points at stays tappable.
- The card is `role="region"`, not a dialog, so InstallSheet (which waits for dialogs to close) is not blocked by it.
- Progress is saved per user in `localStorage` key `hz-intro-v1:app:<userId>` (the anonymous user's save moves to their own id). Every read and write is in try/catch; a private window keeps progress for the visit only.
- iPhone caveat: the installed home-screen app has its own storage, separate from Safari, so a Hopper who installs mid-tour starts a fresh save in the installed app. That is why the install step is skippable and alerts re-offers it later.

## Events

Call `introEvent(name)` from anywhere, any time, any number of times. Events are facts, not steps: one fired early is remembered.

```ts
import { introEvent } from "@/lib/intro";
introEvent("box_opened");
```

| Event | Fired by | Wiring needed? |
|---|---|---|
| `map_ready` | the events map is up | yes, one line (A) |
| `location_granted` (`{ lat, lng }`) | position known | bridged automatically from `useLivePosition`; or call it yourself |
| `location_denied` | permission refused | bridged |
| `location_needed` | Play or a box was tapped with location off | yes (B) |
| `outside_lagos` | position outside Lagos | optional (the coordinates already do it) |
| `play_entered`, `play_exited` | Play shell | bridged from `onPlayEvent` |
| `box_opened` | a box reveal finished | bridged from `onOpenEvent` (`open-done` with an ok result) |
| `welcome_done` | all three welcome boxes open | bridged from `onPlayEvent` |
| `install_done` | the browser's `appinstalled` | bridged |
| `alerts_on`, `alerts_denied` | the alerts button | the default action fires them; fire them yourself if Me's alerts control is used |
| `deck_viewed` | Today deck mounted | yes (D) |
| `event_opened` | event card or sheet opened | yes (E) |
| `chat_opened` | an event chat opened | yes (F) |
| `crew_viewed` | Crew page mounted | yes (G) |
| `me_viewed` | Me page mounted | yes (H) |

## The `data-intro` targets

An element may carry several names, space separated (`data-intro="box far-box"` is fine). The first target found on screen gets the ring. Missing is fine: the card shows without a ring (except `chat`, which waits for its target).

| Name | Element | File |
|---|---|---|
| `avatar` | your face on the map | `src/components/play/MapMarker.tsx` (add a `dataIntro` prop) used by `Avatar.tsx` |
| `locate` | the crosshair button | `src/components/map-chrome/TopChrome.tsx` |
| `install` | the Add to home screen row on Me, or any install button | `src/components/me/SettingsGroup.tsx` (optional) |
| `alerts` | the alerts control | the Me alerts row, or a HUD pill |
| `box` | each welcome box marker | `PlayLayer.tsx` (`MapMarker`) |
| `far-box` | the far welcome box (slot `c`) | `PlayLayer.tsx` |
| `play-exit` | the HUD back arrow | `src/components/play/Hud.tsx` |
| `today-tab`, `crew-tab`, `me-tab` | bottom bar links | `src/components/BottomNav.tsx` |
| `deck` | the Today deck stage | `src/components/today/Deck.tsx` or `src/app/discover/page.tsx` |
| `event-chat` | the EVENT CHAT link | `src/components/event/GoingFoot.tsx` |

## Wiring: exactly what changes where

Everything below is a small edit to an existing file. Do them in this order.

### 1. Mount the host (`src/app/layout.tsx`)

```tsx
import IntroHost from "@/components/intro/IntroHost";
// ...
<Toaster />
<SignupSheet />
<InstallSheet />
<IntroHost />
```

It draws nothing unless a step is current. It is quiet on `/report/*`, `/admin*` and `/dev/intro`.

### 2. Map ready (`src/app/page.tsx`)

The page already has `onMapReady={setMap}` on `NightMap`. Add:

```tsx
import { introEvent } from "@/lib/intro";
// ...
onMapReady={(m) => { setMap(m); introEvent("map_ready"); }}
```

### 3. Locate: use the map's own function (`src/app/page.tsx`)

The default locate action asks the browser for the position and the bridge reports the answer, but the map does not fly. Register the page's own locate so the map flies to the Hopper:

```tsx
import { registerIntroAction } from "@/lib/intro";
useEffect(() => registerIntroAction("locate", () => onLocate()), [onLocate]); // the function TopChrome's button calls
```

Where the page learns the position, also tell the tour (the bridge does this from `useLivePosition`; do it here only if the page uses its own fix):

```tsx
introEvent("location_granted", { lat: fix.lat, lng: fix.lng });
```

### 4. Play shell (`src/components/play/PlayLayer.tsx`, `Hud.tsx`, `MapMarker.tsx`)

Entering, leaving, box opens and the welcome-done moment are bridged. Add the targets and the two things the bridge cannot know.

`MapMarker.tsx`: a prop that sets the attribute on the marker element:

```tsx
dataIntro?: string;
// ...
useEffect(() => {
  if (dataIntro) el.setAttribute("data-intro", dataIntro);
  else el.removeAttribute("data-intro");
}, [el, dataIntro]);
```

`Avatar.tsx`: `<MapMarker ... dataIntro="avatar">`.

`PlayLayer.tsx`, on the box markers (slot `c` is the far one; the welcome boxes only):

```tsx
<MapMarker ... dataIntro={b.kind === "welcome" ? (b.slot === "c" ? "far-box" : "box") : undefined}>
```

`Hud.tsx`, the exit arrow:

```tsx
<button type="button" onClick={onExit} data-intro="play-exit" aria-label="Back to the events map" className="hz-hud-btn">
```

The far box and the avatar run: register the shell's run so the card's SEND IT button starts it (the same function a tap on the far box calls):

```tsx
useEffect(() => registerIntroAction("send_avatar", () => sendAvatarTo(farWelcomeBox)), [farWelcomeBox]);
```

If the far box is still unopened when its step shows, SEND IT must start the run (the run ends in the normal open, which fires `box_opened` and `welcome_done`). For the intro the far welcome box is always reached by the run, so everyone can finish; walking yourself comes later with the daily special box.

When Play or a box is tapped and location is off, tell the tour so it can ask again:

```tsx
introEvent("location_needed"); // where Play shows "Finding you" or "location off"
```

Play must not show the tour over the open moment: nothing to do, the host already hides for `[role="dialog"]` (the open stage is one) and for `open-start`.

### 5. Install (`src/components/app/InstallSheet.tsx`, `src/lib/push.ts`)

Nothing is required: the default `install` action calls `askToInstall()` (already in push.ts), which opens the sheet through the existing sign-in moment, and the host stays out of the way for 2.8 s while the sheet rises. Optional, to point at an install row on Me: `data-intro="install"` on that row.

Later, when InstallSheet gets its own "alerts" moment (the one-line change push.ts already notes), `askToInstall` follows and the tour needs no change.

### 6. Alerts (`src/lib/push.ts`, Me alerts control)

The default `alerts` action calls `enablePush()` and fires `alerts_on` or `alerts_denied`; on iPhone not installed it opens the install sheet instead and the card says "add me to your home screen first". Add `data-intro="alerts"` to whichever control the Hopper would use (the Me alerts row or a HUD pill) so the ring has something to point at. When the Hopper turns alerts on from that control themselves, fire `introEvent("alerts_on")`.

### 7. Today deck and event (`src/app/discover/page.tsx`, `src/components/today/Deck.tsx`)

```tsx
// discover/page.tsx
useEffect(() => { introEvent("deck_viewed"); }, []);
// where a card is opened (the Deck's onOpen, and YourDays' onOpen):
onOpen={() => { setOpen(true); introEvent("event_opened"); }}
```

On the deck's stage element in `Deck.tsx` (the element the cards slide in): `data-intro="deck"`.

If events also open from the map (the event card docked beside it), fire `event_opened` there too, in `EventCard.tsx` or wherever `setOpen(true)` happens.

### 8. Event chat (`src/components/event/GoingFoot.tsx`)

```tsx
<Link href={`/chat?c=${event.id}`} data-intro="event-chat" onClick={() => introEvent("chat_opened")} className=...>
```

The EVENT CHAT link sits inside the event sheet (a dialog). The host allows that: a dialog that contains the target does not hide the card.

### 9. Crew and Me (`src/app/crew/page.tsx`, `src/app/me/page.tsx`)

```tsx
// crew/page.tsx: in the outer CrewPage, so an anonymous Hopper behind the sign-up wall still moves on
useEffect(() => { introEvent("crew_viewed"); }, []);
// me/page.tsx
useEffect(() => { introEvent("me_viewed"); }, []);
```

The Crew step shows even over the account wall, so the explanation still lands.

Replay row, in `SettingsGroup.tsx` next to the existing "Replay the intro" (which replays the title sequence):

```tsx
import ReplayTourRow from "@/components/intro/ReplayTourRow";
// ...
<ReplayTourRow />   // inside the same RowGroup, under Replay the intro
```

It calls `introReplay()` and sends the Hopper to the map, where the tour starts again.

### 10. Bottom bar (`src/components/BottomNav.tsx`)

Add the tab names. `TABS` is a list, so give each entry an optional `intro` and render it:

```tsx
{ href: "/discover", label: "TODAY", Icon: CalendarDays, intro: "today-tab" },
{ href: "/crew", label: "CREW", Icon: Users, intro: "crew-tab" },
{ href: "/me", label: "ME", Icon: CircleUserRound, intro: "me-tab" },
// on the <Link>:
data-intro={intro}
```

### 11. Profile flag (optional)

If someone adds a profiles column named one of `intro_done`, `intro_seen_at`, `onboarded`, `onboarded_at`, `tour_done`, `tour_seen_at`, the module reads it (done on another phone means not shown) and writes it when the tour ends. Nothing else is needed and no table is added.

## Wired

Everything in the wiring list above is done, with these notes:

- `locate` is the page's own function, written in `src/app/page.tsx` (`locateMe`): the same thing "Use my location" does in the location sheet (ask the browser, set the fix so the map flies to the Hopper, say "Locked on"), but without opening the sheet, so one tap on Paz's button does it. It tells the tour `location_granted` with the coordinates, or `location_denied` on a refusal.
- `send_avatar` is registered by `PlayLayer.tsx` for the far welcome box (slot `c`). It starts the same run a tap on the box starts, the card steps out for the run (the store's `opening` flag, which the open moment's own events then keep and release), and the run ends in the normal open, which fires `box_opened` and `welcome_done`.
- The far welcome box is a remote box on the server (`needs_presence` false), so the Play shell treats it like A and B: the avatar runs and it opens, no path nudge, no walk distance. The reach logic for presence boxes stays for later kinds (the special box).
- `location_needed` fires in `PlayLayer.tsx` where Play says "Finding you" or "Turn on location to open boxes".
- `me_viewed` and `crew_viewed` fire from the outer page components, so an anonymous Hopper behind the sign-up wall still moves on.
- `data-intro="alerts"` is on the SPAWN ALERTS block and `data-intro="install"` on its ADD TO HOME SCREEN button (Settings on Me, folded away by default, so the ring only shows when it is open).
- The first-run location sheet (the map opens "Set your location" after the title sequence when there is no fix) stays shut while the tour is still going to ask: `introAsksLocation()` (first-run tour, status idle or running, location unknown, `locate` not seen). A new Hopper meets Paz first and is asked once, by her. The sheet is marked seen as before, and a Hopper with no tour running (done, ended, replay) gets it as it always did. The crosshair on the map still opens it by hand.
- Alerts: the default action fires `alerts_denied` (and the "No wahala" toast) only when the Hopper said no, closed the question, or the device cannot do alerts. A transient failure (`no-session`, `server`) keeps the step and toasts "Could not switch alerts on. Try again in a moment."
- Placement (`useSpotlight.ts`): the card's own height and Paz's headroom are measured (not guessed), the arrow counts as part of the target, and when the card would reach a small target on both sides it rides up over the HUD so it ends above the arrow. A target as big as the screen (the deck) keeps the normal dock.
- `compact` and `reserve` on a step (`steps.ts`): `compact` shows a small Paz that only peeks 54 px over the card and drops the "Your move" row; `reserve` also sets `--intro-reserve` (the card's height plus the peek, in px) and `data-intro-reserve` on the root element while the step shows. Today uses the variable as bottom padding, so the deck stops above the card and the first event stays readable. Used by `deck` (both) and `chat` (compact only).

## Starter quests

Step 12 says "tap one for the details and its quests". The starter quest set on every event is `supabase/starter_quests.sql` (check in, snap the vibe, squad of four, and find the code when staff pass a code; see PLAY-API.md and the file's header). Run it after `schema.sql` and `play.sql`, and again after any `schema.sql` run. This module creates nothing.

## Reviewing it

`http://localhost:3000/dev/intro` (any dev server), development only.

- `?step=box_far` jumps to a step. `?theme=day` or `night`. `?panel=1` opens the controls (also the DEV chip, top right).
- `?loc=denied` or `?loc=outside` makes the locate button answer that way. `?ios=1` pretends to be an iPhone that has not installed Hoppaz.
- The panel has a button for every event, a jump to every step, a fake sheet to test hiding, skip, replay, reset, the events heard and the save.
- The fake background uses the real HUD classes (`hz-hud`, `hz-tray`), the real Mascot and the real button styles.

## Tuning

- Every word: `src/lib/intro/lines.ts`. Bigger Paz moments: the `BIG` list in `IntroHost.tsx`.
- Mascot state per step: `STEPS` in `steps.ts` (states that exist: idle, wave, welcome, oya, secret, point, celebrate, win, oops, sleep).
- When the card deck ships: set `HAS_CARDS = true` in `lines.ts`.
