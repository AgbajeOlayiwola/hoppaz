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

It runs with no env vars at all: the app falls back to a built-in demo night so you
can see every screen before Supabase exists. A violet badge on the map says
`DEMO NIGHT` whenever that is what you are looking at.

### Supabase setup

1. Create a project at supabase.com. Free tier is enough to launch.
2. SQL Editor, run `supabase/schema.sql`, then `supabase/seed.sql`.
3. **Authentication → Sign In / Providers → turn on Anonymous sign-ins.** Without
   this nothing saves and the app stays in demo mode.
4. Project Settings → API: copy the URL and the `anon` key into `.env.local`.
5. The `service_role` key goes in `SUPABASE_SERVICE_ROLE_KEY`, server side only,
   and is used by the moderation route.

### Deploying

Push to GitHub, import into Vercel, paste the same env vars. Nothing else to do.

---

## How it is put together

```
src/
  app/
    page.tsx            map, the landing page
    discover/           the swipe deck
    crew/               crew, search and leaderboard
    chat/               channel chat on Supabase Realtime
    me/                 XP, badges, ladder, history
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
  schema.sql            tables, RLS, RPCs, heat view
  seed.sql              Lagos areas, a sample night, Hop 02
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

---

## What is still open

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
- **Moderation is a curl.** It wants a real screen before anyone but Jae runs it.
- **Crew is one-directional**: adding someone does not ask them. That is fine for a
  small community and wrong once strangers join.
- **No push notifications.** "Your crew just checked in at South Social" is the obvious
  retention loop and is not built.
# hoppaz
