# Hoppaz

What is happening in Lagos tonight, on one map.

A gamified night map for the Hoppaz community. Open it and you land on a dark Lagos
map with a heat layer showing where the night actually is. Swipe through tonight's
events, check in when you get there, collect badges, see your crew, talk in the bus
chat. No sign-up required: anonymous auth gives every Hopper a real identity on first
open, and they can keep going without ever typing an email.

Lagos only, for now.

---

## Stack

| Piece | Choice | Why |
| --- | --- | --- |
| App | Next.js 15 App Router, TypeScript | One deploy, fast on a phone |
| Map | MapLibre GL + CARTO dark-matter vector tiles | Open source, no key needed to start, native WebGL heatmap, and the style is JSON we repaint in the Hoppaz palette |
| Data | Supabase: Postgres + PostGIS | Real geo queries (`ST_DWithin`) instead of fetching every event and filtering in the browser |
| Auth | Supabase anonymous sign-in | Nobody has to sign up, but XP and badges still persist |
| Realtime | Supabase Realtime | Chat, and live heat as people check in |
| Fonts | Self-hosted Poppins + Space Mono | No Google round trip on a Lagos connection |

Deliberately not used: Google Maps (needs billing, styling is restricted, weaker
heatmap), Mapbox (paid past 50k loads, locks the tiles), Firebase (no PostGIS).

---

## Getting it running

```bash
npm install
cp .env.example .env.local     # fill in the Supabase values
npm run dev                     # http://localhost:3000
```

The UI can be opened without env vars, but production features require Supabase. A
production build with missing or unreachable Supabase shows an unavailable state; it
must not be mistaken for a live event feed. Keep demo fixtures out of production.

### Supabase setup

1. Create a fresh Supabase project in the intended production region and save its
   database password and recovery details in the team's password manager.
2. In SQL Editor, run `supabase/schema.sql` against the empty project. This creates
   the tables, PostGIS functions, RLS policies, private photo bucket, and Realtime
   publication entries. Do not run `supabase/seed.sql` in production: it contains
   sample events and test data. Add verified Lagos events through the staff queue.
3. **Authentication → Sign In / Providers → turn on Anonymous sign-ins.** Keep
   anonymous identity enabled; there is no mandatory email registration.
4. Configure the app's Production environment in Vercel with
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `HOPPAZ_ADMIN_TOKEN`, `NEXT_PUBLIC_MAP_STYLE`, and
   `NEXT_PUBLIC_SUPPORT_EMAIL`. The service role key and admin token must never use
   a `NEXT_PUBLIC_` prefix. Generate a unique long random admin token and store it
   in a password manager. Use the same values in Vercel Preview only if you intend
   preview deployments to access production data; otherwise create a separate
   Supabase staging project.
5. Apply the same public and server environment variables in local `.env.local`.
   Restart the dev server after changing them. Set the privacy email to a monitored
   address on Hoppaz's domain before launch.
6. Configure Supabase Auth URL settings with the actual production domain and
   localhost for local work. Check that anonymous sign-in works from the deployed
   domain, then verify RLS using a normal anonymous account before loading real data.
7. Add approved event locations and staff-approved partners/drops at `/admin`.
   The launch desk is protected by `HOPPAZ_ADMIN_TOKEN`; do not share the token with
   players. Publish community rules and have the product owner complete the privacy
   notice's controller identity and retention details before opening the app.

### Deploying

The repository is already intended for the existing Vercel app. After setting the
Production environment values, deploy the reviewed commit from the Vercel dashboard
or CI, then smoke-test the production URL on mobile and desktop. Do not consider
launch complete until the checklist in `docs/LAUNCH_CHECKLIST.md` is signed off.

---

## How it is put together

```
src/
  app/
    page.tsx            map, the landing page
    discover/           the swipe deck
    crew/               friend network and lasting open/private crews
    chat/               event rooms, waves and direct chat on Supabase Realtime
    quests/             quests, Outside Score, streaks and Lagos leaderboard
    drops/              timed event and neighborhood rewards
    admin/              token-protected operations desk
    me/                 XP, badges, account controls and history
    me/avatar/          the look editor: skin, hair, face, Lagos-label wardrobe
    drop/               add an event, with the caption parser
    api/admin/events/   moderation queue, token guarded
  components/
    map/NightMap.tsx    all MapLibre: heat layer, pins, Hop route, crew, radius
    SwipeDeck.tsx       pointer-driven cards, no gesture library
    TitleSequence.tsx   the opening titles, SVG + CSS keyframes
    Avatar.tsx          React wrapper over lib/avatarSvg.ts
    EventSheet.tsx      HopSheet, AreaPicker, Sheet, HeatBar, Wordmark, BottomNav
  lib/
    geo.ts              areas, haversine, the Lagos travel-time estimate
    mapStyle.ts         repaints the CARTO style into the brand palette
    parseCaption.ts     reads a pasted Instagram flyer caption
    avatar.ts           avatar parts, the wardrobe, normalizeLook()
    avatarSvg.ts        draws a look as an SVG string (React and map markers)
    useEvents / useSession / useCheckin / useCrew
supabase/
  schema.sql            tables, RLS, RPCs, photo storage and Realtime setup
  seed.sql              local/demo sample data; never use for public production
```

### The things worth knowing

**Heat** is `base_heat + checkins×7 + swipes_in×3`, capped at 100 (`public.event_heat`).
Seeded popularity carries the map early, then real signal takes over as people swipe
and turn up. It is a placeholder formula: tune it once there is a real weekend of data.

**Check-in is gated server side** at 1500 m inside `claim_checkin()`. Doing that
distance check in the browser would mean anyone can mint badges from their bedroom.
The client only ever asks; the database decides and awards the XP.

**Nothing a Hopper drops goes live on its own.** A trigger forces `status = 'pending'`
on insert, and `/api/admin/events` is the queue:

```bash
curl -H "Authorization: Bearer $HOPPAZ_ADMIN_TOKEN" https://your-app.vercel.app/api/admin/events
curl -X POST -H "Authorization: Bearer $HOPPAZ_ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"id":"<uuid>","action":"approve","lat":6.4386,"lng":3.4655}' \
  https://your-app.vercel.app/api/admin/events
```

Passing `lat`/`lng` on approve replaces the area centroid with the real venue point.

**Instagram import is a parser, not a scraper.** Instagram does not let anyone read a
post server side without their Graph API and a business account, so a Hopper pastes
the caption and `parseFlyerCaption()` pulls out the title, venue, area, date, time,
price and vibe. Everything it finds stays editable before submitting.

**Location** uses real GPS when the Hopper grants it and falls back to picking one of
16 Lagos areas. Every distance, travel estimate and check-in works the same either way.

**The opening titles** are modelled on the Silicon Valley (HBO) intro: one long
sideways camera move across a flat illustrated Lagos at night (mainland, Third Mainland
Bridge with the bus on it, the Island, the Lekki-Ikoyi Link Bridge, Eko Atlantic) where
buildings sprout as they come into frame and rooftop signs pop up and flip between
tonight's real events. It plays once, then the map swoops down into a pitched 3D city
whose buildings grow out of the ground the first time you zoom in. Replay it from the
Me tab. Reduced-motion users skip it.

**Avatars are untrusted input.** A look is JSON on `profiles.avatar` and other Hoppers'
looks are drawn on your map, so `normalizeLook()` maps every field onto the whitelists in
`avatar.ts` and nothing stored is ever interpolated into the SVG.

**Venues are Sims lots.** Each event is nine flat-coloured boxes in MapLibre's own 3D
layer (`lib/eventLots.ts`): plinth, cream walls, door, stepped roof, and a floating
diamond whose colour is the crowd level. They show from zoom 13; closer in, the dots fade
and the billboards float above the roofs.

**Crowd, live vs expected.** The heat map has a clock. NOW is real check-ins from the last
three hours (`here_now` in `events_near`). Every later slot is an estimate from the event's
heat and a typical Lagos night (`lib/crowd.ts`), and the UI says EXPECTED so nobody reads a
guess as a crowd.

**Event photos** live in the private `event-photos` storage bucket. Only a Hopper the
server has checked in at that event can submit one (enforced in RLS, not the client).
New images stay hidden pending review; the staff launch desk approves or rejects them.
Approved images are served with short-lived signed URLs.

---

## Launch status and remaining setup

- **Production credentials and cloud provisioning are external setup.** The project
  still needs its production Supabase project, Vercel environment values, verified
  Lagos listings, real partner agreements, and a live deployment smoke test.

- **The wardrobe names real Lagos labels** (Orange Culture, Lagos Space Programme,
  Kenneth Ize, Tokyo James, Maki Oh, Lisa Folawiyo, Mai Atafo, WAFFLESNCREAM, Motherlan,
  Severe Nature, Cute Saint, Andrea Iyamah, Femi Handmade). Pieces are drawn in their
  spirit, no logos, but get each label's OK before launch. It is also the natural
  brand-partnership slot.

- **The heat map needs density.** With sixteen events across Lagos the heat layer reads
  as a few disconnected blobs. It becomes the feature it is meant to be at roughly 40+
  events a weekend, or by weighting check-ins much harder so a single busy venue glows.
  Fill the calendar before judging the layer.
- **Travel time is a formula, not a route.** 2.4 min/km plus 18 minutes for a bridge.
  Fine for a sort order, not fine for telling someone they will make the 11:30 stop.
- **Dropped events sit at the area centroid** until an admin approves them with a real
  point. A map-tap pin picker in the drop form would remove that step.
- **Legal and operational launch details need owner input.** Confirm privacy contact,
  data retention, incident response and moderator coverage before public launch.
- **No push notifications.** "Your crew just checked in at South Social" is the obvious
  retention loop and is not built.
# hoppaz
