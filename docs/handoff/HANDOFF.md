# Handoff: Hoppaz UI refresh (cloud session to local)

Written 8 Oct 2026 when the work moved from a Claude Code cloud session to Jae's machine. Read this first, then `docs/UI-REFRESH-PLAN.md` (the locked decisions and the spec).

## Where things are

- Repo: `jaethecreator/hoppaz` (Jae's fork of `AgbajeOlayiwola/hoppaz`). **Never push to Ola's repo.**
- Branch: `ui-refresh`. Commits, oldest first:
  1. Foundations (tokens with a night and day set on the Lagos clock, Archivo + DM Mono + Poppins, lip button, ticket stub, pills, chips, DayRail, Mascot rig component, real logo and icons, toasts, bottom nav). Reviewed by the lead.
  2. Shared `useGoing` hook (the one "I'm going" save). Reviewed by the lead.
  3. Plan updates (Bachs findings, brand quest builder stage).
  4. **WIP (unreviewed):** Map, event page, Today, Me and app-wide screens from six parallel builders. Typecheck passes. Reports in `docs/handoff/builder-reports.md`.
  5. **WIP (unfinished, unreviewed):** Crew and Chat restyle. The builder was stopped mid-task. It added new files (`src/app/crew/CrewPanel.tsx`, `src/components/chat/Bubble.tsx`, `Inbox.tsx`, `useLinger.ts`): check these against Jae's rule that Crew and Chat keep their current **structure** and only get restyled.
- Nothing from the per-screen review pass ran (one reviewer, map-chrome, was mid-way when stopped).

## What to do next, in order

1. **Lead review of commit 4** (the promise to Jae: nothing ships unreviewed). Read every diff screen by screen. Look for: edits outside each builder's files, logic or Supabase changes in a UI-only pass, hard-coded hex colours, emoji, em dashes in copy, orange on non-tappable things, violet anywhere but drops, filled state colours, text under 10px, day-theme legibility, dead code. Then `npm run typecheck`, `npm run lint`, `npm run build` (production build catches what dev hides).
2. **Look at every screen** at phone size (390x844) in both themes: add `?theme=day` or `?theme=night` to any URL. Check opened states (tap an event, open sheets, empty day). `docs/handoff/shot.mjs` is the screenshot helper used in the cloud (it pre-seeds localStorage to skip the intro); it needs Playwright, so adjust the `require` path to your local install or run `npx playwright install chromium` first.
3. **Finish Crew and Chat** (commit 5): restyle only. Its task is the `crew-chat` entry in `docs/handoff/build-spec.workflow.js`.
4. **Run the per-screen reviews** that never ran: for each surface, check every bullet of its task (see "Build spec" below) is DONE, fix gaps.
5. **Sync with Ola.** Ola keeps pushing to `AgbajeOlayiwola/hoppaz` (about 1,800 lines on 8 Oct alone). Add his repo as `upstream`, fetch, and merge or rebase `ui-refresh` on his `main` often, resolving conflicts. The longer this waits, the harder it gets. Tell Ola a UI pass is happening on a branch.
6. **Twin venue models on the map** (plan section 3, step 4): a MapLibre custom layer drawing `public/venues/<id>.json` from the venue builder in `jaethecreator/hoppaz-anchor-lab` (branch `venues-3d`, folder `twin/`). Test both patch sizes (venue only vs venue plus block). No violet moon. The map-canvas builder left a mount point in `src/components/map/venueModels.ts`.
7. **Drop reveal** (four sealed boxes), later reused for the Game Plan's daily box.

## Running it locally

```
git clone https://github.com/jaethecreator/hoppaz && cd hoppaz && git checkout ui-refresh
npm install
npm run dev            # http://localhost:3000 ; runs on dev sample data without Supabase env
```
Dev sample events are relative to today (14 days, some daytime, one after-midnight). They never appear in production builds.

## Decisions Jae made in the planning conversation (also in the plan)

- Keep the 3D city but repaint it neutral; models only at events (Campus Twin venue patches); remove the Sims lots; no moon.
- Real logo everywhere; the H mark is the app icon.
- "TODAY" (6am to 6am Lagos) instead of "Tonight"; the bottom tab says TODAY.
- Event page: cut "How the night goes", stat tiles, city-wide quest forms, chat preview, source label, tag row, footnote. Keep only this event's quests. Guest list shows count + your face + your crew's faces (who's going stays private, no back-end change).
- Lineup ("Harry Obi, on the panel") is a separate section; needs a lineup field (back end, later).
- Streak chip stays in the map's top bar (drawn flame icon, never emoji) and opens "Ways to earn".
- Quests live on Today's cards and in "Ways to earn" on Me; the Quests page folds into Me.
- XP level names proposed: JJC, Regular, Plug, Oga, Agba (pending Jae's final word). Hopper and Captain are bus status (4 Hop badges = Captain), never XP levels. No "Bridge Rat", no "-er" names.
- Crew: keep its structure, restyle only. Crew board idea (share of crew out this week) is a suggestion.
- Privacy contact: itshoppaz@gmail.com, controller Hoppaz.
- Install sheet after the first "I'm going", once more after the first check-in, then never.
- Brand rules: no em dashes, no emoji in UI, conductor voice, "Hoppers".

## Research done (summaries)

- **Competitors (community features):** Eventbrite and Ticketmaster have follow plus alerts, no community. Posh (feed + follows), Luma (chat, newsletters), Shotgun (follower alerts), Whova (conference community) each have pieces. Nobody combines claimed pages, follows, updates and community in Nigeria. Moonshot sells through Mainstack.
- **Brand-set quests and rewards:** nobody offers a self-serve builder for pre-event and post-event quests with brand-funded rewards. What exists: referral cashback (Posh Kickback, Shotgun Cashback, Tixr Rewards, Ticket Fairy, Skiddle Reps), conference quest apps (Eventify, Amego, POAP Journey), one-off builds (Coachella Quests 2024, Defqon.1 The Path). Evidence is vendor-reported; fraud defence = pay real rewards only on verified purchase or check-in, with caps. Nigerian prize draws need a National Lottery Regulatory Commission permit; prefer fixed rewards for actions.
- **Bachs (payments):** see plan section 4. Connect sub-accounts can pay organisers directly ("organiser collects" recommended). Clear in writing: the "mystery boxes and random pack openings" prohibition vs the Game Plan's free boxes, that event ticketing is allowed, licence, local card cap. Jae knows the owner.
- **Social quest verification (X API, Instagram APIs, Groq vision): NOT finished.** Re-run this question: for each action (follow, like, repost, mention, post tagging the brand, story mention) on X and Instagram, which can be verified by API (and the cheapest X API tier and monthly cost in 2026, noting X made likes private in 2024), which need a screenshot checked by a cheap vision model on Groq (models and price per check), what X's and Meta's rules say about rewarding follows and likes, and the anti-fraud design for screenshots (handle match, freshness, duplicate-image detection, review queue, re-checks). Jae mentioned "XABS" for X at Absinthe Labs: confirm what that is.

## Build spec

The full per-screen tasks given to the builders (owned files, every bullet, and the shared context) are in `docs/handoff/build-spec.workflow.js` (the SURFACES array). The essentials are in `docs/UI-REFRESH-PLAN.md` section 2. The earlier audit of every screen against the design system is in `docs/handoff/audit-verified.json` (keyed `verify:<surface>`) and `docs/handoff/audit-gaps.json` (cross-cutting gaps). It was written against older code, so line numbers have moved.

## Source material (outside the repo)

Design System Draft (PDF), Mascot Rig v3 (HTML), Game Plan v2 (MD), 3D Model Build (MD), Campus Twin (ZIP) and the logo PNGs were uploaded to the cloud chat. Keep copies on your machine and point the local session at them.
