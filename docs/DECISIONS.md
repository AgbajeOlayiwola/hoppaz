# Decisions

Jae's calls, newest first, so the team (and Ola) build to the same thing.

## 9 Oct 2026

| Topic | Decision |
|---|---|
| Play mode | Approved as specified in [PLAY-MODE.md](PLAY-MODE.md), all five decisions in its section 12: yes. Tapping your own avatar enters Play; boxes never show on the events map. |
| Sounds | Gamified sounds in Play mode, built on Lagos instruments: shekere, agogo, talking drum, danfo horn, a crowd "ehn". |
| Account wall vs first box | A new Hopper opens their welcome boxes without an account. After that, sign up to keep what they won ("Sign up to keep your Golden Danfo"). Ola's gate stays for everything else. |
| Today | Our browse deck, not the yes or no swipe: slide left and right through events, tap a card for the breakdown. A separate WE OUTSIDE button keeps "I'm going". |
| Collectible card deck | Go (the Lagos deck from the Game Plan, fed by boxes). |
| Cards | Mainly places (areas, streets, landmarks, food, public things), Nomad List style: Hoppaz brings you to new places and teaches you about them. Keep the deck's existing segmentation. Every card is tagged to its location; going there yourself stamps it Visited. Cards from your area come more often, but cards from anywhere can spawn near you. Cards ship without photos ("Wanted: your shot"); the best Hopper photo becomes the card art. Ola builds the back end from the note in CARDS.md. |
| Chill deck | Test it inside Play. |
| Streak freezes and paid repair | On hold. |
| Box alerts | Go. They need the app installed to the home screen on iPhone; prompt after the 3rd box (Play mode decision 5). |
| Gamified first-run setup | Go, Duolingo style, very jovial, Paz the Conductor guides: map, install, location, tap your face, three boxes (two near, one far with the avatar run), spawn spots, alerts, the Today deck and quests, event chat and crews, Me. Built straight on the real screens (no mock). Every event gets a starter quest set. It has to work end to end. |
| Crew board | Go: crews ranked against each other by how many went out this week (the Game Plan version). The Crew page's XP list of you and your crew already exists. |
| Play: spawn spots | Boxes spawn at spots several times a day (not too many), open 90 minutes. You get an alert and send your avatar: it runs there in 10 to 60 seconds, or you steer it along the road. It can travel up to about 3 km from you. While travelling nobody sees it; within 150 m of the spot it appears to everyone else there, like a small meta room. Nobody has to be there physically. |
| Play: spot box | The first N avatars to tap it each get a random reward (not the same thing). N starts at 10 and staff can raise it per spot. |
| Play: rooms | In a spot room you show as a fun nickname for that spot plus your look; your handle shows after a returned wave or an accepted link up. Real names stay hidden. A short random arrival delay. |
| Play: tapping a head | Wave (Ola's poke, then his chat), Link up (a friend request: accepted means crew and a chat), Vibe (a quick animated sticker over their head, like "we outside"). |
| Play: special box | Unique to you, you walk to it yourself. Unlocks 4 hours after sign-up. No 24 hour wait on anything else. |
| Play: alerts | Each Hopper picks how many spawn alerts they get: Off, A few (about 3 a day), All. |
| Rewards | XP plus cards; XP keeps coming once the deck exists. |
| Profiles | Hide the home area from other people. Name and XP can stay public. |
| Fake accounts | Verify email with a 6 digit code (Supabase, free; needs an email sender such as Resend). Phone or WhatsApp codes later if needed. |
| Card mix and odds | A box picks cards by distance: 30% within 3 km of you, 30% from 3 to 8 km, 40% from anywhere (replaces "home area 3x", which gave only about 6% local cards). Special box card tier 84 / 13 / 2.7 / 0.3; the 7-day Golden Box Epic 97, Legendary 3. Details in CARDS.md. |
| Social quests | Later, not in this build. Simple and nearly free: Hoppers submit a screenshot as proof in our own "Submit proof" flow (no Airtable), a Groq vision bot checks it against the organiser's X or Instagram handle and the Hopper's own handle, and anything unsure goes to the admin review queue. Rewards stay XP and points. Research in SOCIAL-QUESTS.md. |
| XP level names | JJC, Regular, Plug, Oga, Agba. |
| XP rebalance | Approved. Ladder JJC 0, Regular 500, Plug 2,000, Oga 6,000, Agba 15,000, each with ranks I, II, III. Going out pays most: check-in 100, Hop stop 250, event quests doubled. Boxes pay mostly cards and Gist: box XP 10, 25, 60, 150 by tier, capped at 150 XP a day. A full-screen level-up moment with Paz and the crowd "ehn". |
| Organisers | Their own tools in the admin area, run by the organisers themselves on a normal Hopper account (no staff doing it for them). Staff only approve a claim. They claim their events, add lineups and updates, and set venue badges (for example 4 visits makes you a Regular). |
| Mascot | Paz. Full name: Paz the Conductor. |
| Hotspots: zones | Replaces the size classes. Jae: "Segment Lagos into zones. Just segment the zones that are very large, and each zone has one room (one hotspot). Then over time, as more people come, we break down the rooms. Keep it simple." His examples: Lekki is one zone, from Phase 1 along Lekki down to one side, then cut; Ikoyi has its own zone. The zone you are standing in is your hotspot; anyone can still visit any hotspot. Proposed in [HOTSPOTS.md](HOTSPOTS.md) section 4, not yet approved: the 13 zones with their junctions, and the split trigger (60 people at the daily peak for 7 days in a row, then staff split the zone along its written cut). |

Still open: photos on Me and in crews, the rabbit face rule for Paz, ticketing for organisers, a catalogue screen of every collectible, 3D venue models, the strict four colour rule, and crew faces on events (needs one small database addition).

Today page: approved as the advertisable mock (9 Oct 2026). The flyer is the whole card with a ticket strip and TAP FOR DETAILS; the screen takes each event's colours and blends as you slide; 3D neighbours with an agogo tick on snap; live countdown, going count with crew faces, BOX HERE badge, an honest Featured label; tap for details with I'M GOING and WE OUTSIDE; Share to story makes a real 9:16 image; a demo mode for filming ads. Jae: "that share to story is sick."

Today page approved for use (9 Oct 2026, after testing on the phone). Sliding the deck left or right makes no sound (Jae found the tick annoying); the other sounds stay as they are.
