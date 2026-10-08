# Hoppaz UI Refresh Plan

Owner: Jae. Branch: `ui-refresh` on `jaethecreator/hoppaz` (a fork of `AgbajeOlayiwola/hoppaz`; Ola's repo is never pushed to).
Sources: Hoppaz Design System Draft (8 Oct 2026), Hoppaz Mascot Rig v3, Hoppaz Game Plan v2, Hoppaz 3D Model Build, the brand rules, and the decisions made with Jae in the planning conversation on 8 Oct 2026.

This pass is **UI only**: restyle, re-layout, cut, copy and motion. No schema or server changes, except where a line below says "back end" and is marked for a later phase.

House rules for every screen: no em dashes, no emoji in the interface, orange means "tap me", violet means "drop" and nothing else, Night Black is `#0E0B0A` (never pure black), Bridge Cream is `#F5EBDD` (never pure white).

---

## 1. Decisions locked

| Area | Decision |
|---|---|
| Logo | The real wordmark (with ears) in the top bar and loud moments; the H-with-ears mark as app icon. Cream on night, orange or ink on cream. Files in `public/brand/`. |
| Theme | Follows the Lagos clock: cream ground by day, Night Black after sunset (about 6:45pm). A card follows its own event's start time. |
| Fonts | Poppins 600/900 for display and numbers only; Archivo for reading; DM Mono for labels, dates, prices. |
| Colour | The design system's four tiers. Tier 2 state colours (Keke, Lagoon, Danfo, Violet, Fire Ant) only as text, pill borders, dots or icons, never as a filled surface. |
| Buttons | Lip button: orange face, dark ink label, 6px radius, 4px ember lip, press sinks 4px. |
| Containers | Ticket stub (two punched notches) for anything that represents one night. |
| Day boundary | "TODAY" runs 6am to 6am Lagos time, so a 1am party belongs to the night before. |
| 3D city | Stays, repainted in the twin's neutral concrete (no ember or orange buildings). It grows in the first time it shows, as in the original. (Jae, 8 Oct, after seeing the build: the original map was better; only the orange towers and the always-on purple had to go.) |
| Event 3D | The Sims houses stay at every venue for now. Campus Twin venue models replace them when they are ready (test venue-only vs venue-plus-block). Moon left out. |
| Camera | The original: after the intro the map swoops down from high over Lagos into a tilted, angled city. Tapping an event pulls in close and tilted; the event card docks on the right and the venue's house stands on the left with its card over its head. Closing puts the camera back. |
| Ladder | Status from the bus (canon): join = Hopper, 4 Hop badges = Captain. XP levels get their own names, proposed **JJC, Regular, Plug, Oga, Agba** (pending Jae's final word). "Bridge Rat" and "Night Runner" are gone. |
| Guest list | Who's going stays private. The event shows the count, your own face, and your crew's faces when your crew planned that event. |
| Lineup | A separate "lineup" section (name, role, organiser-supplied photo). Needs a lineup field: back end, phase 2. |
| Quests | Live on Tonight cards (each event's quests and the reward for going) and in a "Ways to earn" sheet opened from your XP on Me. The Quests page goes; Drops and the month report card move to Me. |
| Crew | Keep the current structure. Restyle only; ideas go to Jae as suggestions, not changes. Crew board idea (below) is a suggestion. |
| Privacy contact | itshoppaz@gmail.com, controller name Hoppaz. |
| Install sheet | After the first "I'm going"; if dismissed, once more after the first check-in; then never. |

---

## 2. Screen by screen

### Map
- Night rail across the top: 14 days, weekday, date number, "N on". Opens on TODAY. Calendar icon opens a month grid for further out. Replaces the native date pickers and "Any day".
- Top right: a streak chip (drawn flame icon plus the daily streak number). Tapping it opens "Ways to earn". The XP level chip leaves the map.
- Markers: far out, the original rooftop billboard (cream board on two posts, crowd diamond, price, time, minutes away) popping up one after another. At street zoom it becomes a card with the event image, name, price and time, floating over the venue's house. The declutter logic decides which events get full signs.
- Bottom: one slim time scrubber (the map's one ambient moment). Radius and "You are in" move into the location sheet as four plain choices. Zoom buttons hidden on touch devices, kept on desktop. Map credit stays visible.
- Hop: the purple route, purple numbered stops and the bus's purple edge show on the Hop's day only. Other days, no purple: the bus is parked at the next boarding point with a "NEXT HOP · SAT 18" banner that opens the Hop.
- Crew faces leave the map (their positions were made up). Your own face marks where the map works from, as in the original.
- Night basemap is the original paint (Night Black, orange arteries); day is cream. Signs pop in, the bus bobs while it drives, the map swoops in and the city grows, as in the original.
- Remove every player-visible developer message ("database not configured" and friends). Sample events only in local development.

### Event page
- One sheet, built as a big ticket stub: flyer as art, title, one mono line (DAY · TIME · AREA · PRICE), at most one coloured pill.
- Guest list above the fold: big going count, your face, crew faces.
- One "I'M GOING" lip button that stamps your face onto the list. SHARE (WhatsApp-ready text plus a link that opens this event). TICKETS link out.
- This event's quests only, one line each with the reward; the form opens on tap.
- One drop row (violet dot) that opens the drop reveal.
- Check-in: "CHECK IN" (no XP number on the button), "CHECK-IN OPENS AT THE VENUE" when far. Success punches the stub.
- Cut: "How the night goes", the three stat boxes, the city-wide quest forms, the chat preview (replaced by one "EVENT CHAT · N talking" line), "No pictures yet", source label, extra tags, the footnote.
- Tonight and the Map open the same event page.

### Tonight
- Night rail, then a conductor line in cream: "23 Hoppers out. Drops at 2 spots."
- A list of ticket stubs for the selected day, most going first. Each card: event image, price, location, its quests and the reward for going, an "I'M GOING" button. Swiping stays as an optional "Can't decide? Swipe" mode.
- "Your nights" strip at the top (events you are going to, rebuilt from saved swipes, tappable). Replaces the "You said you are in" footer.
- Empty day: mascot asleep, "Quiet one.", a button to the next busy day.
- Cut: heat bar, the eight-fact info panel, duplicate MAP button.

### Me
- Avatar, one big level name, the status title (Hopper or Captain with badge stamps), the small mascot reflecting how you are doing.
- Two big numbers: daily streak and XP. Tapping XP opens "Ways to earn".
- Badge shelf as stamped stubs (drawn marks, no emoji).
- Rows: Month report card, Drops, Collection (future album home).
- Settings collapsed at the bottom. STAFF link only for staff. Player-friendly offline line.
- Scores consolidated: Outside Score and Lagos rank leave the everyday screens (rank can appear on the month report card).

### Crew and Chat
- Crew keeps its structure; fonts, colours, buttons and stubs only.
- Chat: deliberately plain. Quiet tabs instead of orange buttons, room pills that are not orange-filled, dim author names, ground-colour bubbles, no "LIVE" line.

### App-wide
- Toasts: one neutral card with a coloured dot (green done, red failed, violet drops only).
- One header pattern; a tab stays lit on its sub-pages; the tab bar hides inside a private chat, the flyer form, the avatar editor and admin.
- Branded 404 and crash pages, offline line, loading states that never say "empty" before data arrives.
- Minimum label size 10 to 11px, tap targets 44px, pinch-zoom allowed on text pages.
- Intro kept, about 5 seconds, tap to skip, ends on the mascot.
- Privacy page styled, owner notes removed, contact filled in.

---

## 3. Build order

1. **Foundations.** Tokens (night and day), fonts, lip button, ticket stub, pills, toasts, night rail, mascot component, real logo. Nothing else ships until these hold.
2. **Map** (without the twin layer), **Event page**, **Tonight**.
3. **Me**, app-wide states, Crew and Chat restyle.
4. **Twin venue models** on the map: a MapLibre custom layer drawing `public/venues/<id>.json` from the venue builder, both patch sizes behind a switch for testing.
5. **Drop reveal** (four sealed boxes), later reused for the Game Plan's daily box.

---

## 4. Organiser phase (after this pass)

Hoppaz as a listing and community place for organisers, staged so nothing heavy is built before demand is proven.

| Stage | What | Needs |
|---|---|---|
| A. Claimed event pages | An organiser claims their listing, adds a lineup and posts updates. Hoppers tap Follow and see updates in the app. Tickets still link out. | Back end: claims, lineup, updates, follows. Organiser panel v1. |
| B. Ticket pledge | Organisers give tickets (3 minimum, more buys more placement) that power quests and box prizes across the app. Ticket prizes only drop before the event; unclaimed ones return. | **Pilot now with no code**: the existing drop system already supports "ticket" rewards with codes. Legal check: random prizes with cash value may count as a promotional competition. |
| C. Native ticketing | Hoppaz sells tickets and takes a fee. Market: Tix about 5% plus a small per-ticket fee; Paystack about 1.5% + N100 capped at N2,000. Jae: prices start cheap to pull organisers over. Recommended shape: a **founding organiser rate** (e.g. 2.5%) locked for 6 to 12 months for the first 20 to 50 organisers, with the end date announced up front, then the standard 4.5% (or 5% with promotion bundled). Avoid 0%. The platform fee is pure margin because Bachs processing (1.5 to 2%) sits on the organiser or buyer. Pitch instant naira payouts loudly. Payment rails: **Bachs** (bachs.io; Jae knows the owner), see below. | Ticket layer built by Hoppaz (ticket types, QR tickets, door scanning); Bachs Connect for money. |


### Bachs (payments for Stage C), checked 8 Oct 2026

- **What it is:** payments and billing infrastructure (checkout, subscriptions, settlement), not a ticketing product. Hoppaz builds the ticket layer on top.
- **Organiser payouts:** Connect (sub-accounts), Stripe Connect style. Recommended shape: **the organiser collects** (direct charge into the organiser's sub-account, Hoppaz takes a per-ticket `platform_fee` as a fixed amount), so refunds and disputes hit the organiser's balance. Small individual organisers may suit "Hoppaz collects" instead (shorter onboarding, Hoppaz carries refunds). Hoppaz must upgrade to a registered business and pass compliance before Connect works in production.
- **Fees (docs):** NGN bank transfer 1.5% capped at N2,000; Nigerian cards 2% (Beta, no cap shown); US cards 5% + $0.40, non-US cards +1.5%; mobile money 3.5% (pricing page says 2 to 3%); crypto 1.5%. NGN available immediately; NGN payout N50 flat.
- **Refunds:** full or partial via API; Bachs keeps its processing fee and the platform fee is not reversed. Hoppaz needs a written refund policy.
- **Worked example, N10,000 ticket, organiser collects, Hoppaz 4.5%:** bank transfer, organiser keeps N9,400; Nigerian card, N9,350.
- **Risks to clear in writing before integrating:**
  1. Bachs prohibits "mystery boxes and random pack openings" and "games of chance". The Game Plan's daily box and card packs are free (nothing random is sold); get written confirmation this is acceptable on the account.
  2. Event ticketing is not explicitly listed as a supported business; confirm it is allowed.
  3. Licence (CBN) not stated in the docs.
  4. Local card cap, and which fee table is current (docs vs pricing page).
  5. Connect production review timeline.

**Claim campaign:** "Are you a brand or organiser? Claim your event on Hoppaz. DM us." Runs alongside Stage A.

**Notifications:** organiser updates need push, which only works on iPhone after the app is installed to the home screen. The install sheet comes first; WhatsApp stays the reliable channel.

## 4b. Brand quest builder (after the UI launch)

The differentiator. Research on 8 Oct 2026 found no ticketing platform with one self-serve builder where organisers and brands set both pre-event and post-event quests and fund the rewards. What exists is referral cashback (Posh Kickback, Shotgun Cashback, Tixr Rewards, Ticket Fairy, Skiddle Reps), conference app quest builders (Eventify, Amego, POAP Journey) and one-off festival builds (Coachella Quests 2024, Defqon.1 The Path). Nothing like it in Lagos or Africa. Jae ran social questing at Absinthe Labs; the model carries over from web3 to events.

**Roles:** brands and organisers set the quest line and fund the rewards; Hoppaz builds the quest line, verifies actions, and can power ticket rewards. Hoppaz adds XP and badges on top, and they carry across organisers (nobody else does that).

**Order:** launch the UI refresh first, then build this.

**Where the model comes from (Jae, Absinthe Labs):** Absinthe ran questing for web3 companies; Hoppaz runs questing for social and IRL. At Absinthe: follow quests on X and Instagram (sometimes Medium), plus "follow our account"; X checks through the X API ("XABS", to confirm); Instagram through an in-house Airtable-style tool where people submit a screenshot and it is confirmed manually or by AI. For Hoppaz the AI check runs on a cheap vision model on Groq: the brand screenshots its own Instagram page as the reference, the person submits a screenshot showing they follow, liked the post, or reposted the brand's story. Mentions on X (a post tagging the brand) are confirmed through the X API.

**Examples Jae gave:** Blockfest running pre-event follow and repost quests; South Social running on-the-night tasks ("snap pictures with four people", "snap pictures with three people", "snap the DJ", "post on X tagging the brand") that make the night livelier while promoting the brand. Pre-event, during or post-event, depending on what the organiser wants.

**Business points:** brands set the rewards, that is on them; Hoppaz's job is to create the quest line. Events hosted on Hoppaz get referral tracking. Hoppaz can power ticket rewards for brands that want them. Real rewards pay only for verified actions, so it can't be gamed.

**Quest line, by phase:**
- Pre-event: say you're going; follow the brand on X or Instagram (and Hoppaz); like or repost the announcement; share your referral link (Hoppaz tracks referrals for events hosted on Hoppaz); bring your crew.
- At the event: check in (server-verified location, already built); scan the sponsor's QR (already built); photo tasks set by the organiser ("snap a picture with four people", "snap the DJ"); post on X or Instagram tagging the brand.
- Post-event: recap photo (only after a verified check-in); rate the night; say you're going to their next one; buy the merch.

**Verification:**
- Hoppaz-native actions (going, check-in, QR, photos, referrals): verified by the app itself.
- X: follow, like, repost and mention checks through the X API (tier and cost: see research notes below).
- Instagram: tags and story mentions through Meta's APIs where the brand connects its professional account; follows and likes by screenshot, checked by a cheap vision model (Groq) with a human review queue for low-confidence cases.

**Guardrails (from the evidence):** real rewards only for verified actions, capped per person; shares and invites earn XP, not brand rewards; brands deposit reward codes or stock before a quest goes live (same as drops today); no prize draws without a promotional permit (fixed rewards for actions instead); fraud defences on screenshots (handle must match the linked account, freshness, duplicate-image detection, spot checks, re-checks).

**Builds on what exists:** quest types (check-in, photo, venue code or QR, text, crew) and reward types (XP, badge, discount, ticket, upgrade, collectible) are already in the schema and the admin desk. The builder exposes that to organisers, adds social quest types, and adds the verification pipeline.

## 5. Card of the Day

- Daily content using the deck. Only signed, place or public-domain cards are featured.
- Unsigned cards (89 in Season 1) appear only as locked silhouette slots with no name or likeness: "A Grammy Club card is waiting for its artist. Is it you? DM us." Same pattern for brands.
- Admin gets a Card of the Day scheduler that shows each card's sign-off status and refuses unsigned cards.

## 6. Suggestions parked for Jae

- Crew board: crews compete on a Lagos board by the share of the crew that went out this week, so small crews can top it. Individual leagues of 30 stay per the Game Plan. The friends-only XP leaderboard goes.
- Twin coverage: real venues need `build_venue.py` runs (use `--source overture` in cloud sessions).

## 7. Open items

1. XP level names: confirm JJC, Regular, Plug, Oga, Agba, or replace.
2. Mascot: the Game Plan lists 8 moods, the rig has 10 states; which list is current, and the name (Waka) and the "no rabbit face" brand rule.
3. Daytime card cutoff: events starting before 5pm get the cream card (proposed).
4. Chat: does the "restyle only" rule for Crew also apply to Chat?
5. Bachs demo call: the five questions in section 4.
