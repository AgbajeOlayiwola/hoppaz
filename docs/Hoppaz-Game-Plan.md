# Hoppaz Game Plan

The city game for people who go out in Lagos. Version 3, 8 October 2026. This replaces version 2 and holds every decision made so far, so other chats and other people can work from it without re-deriving anything. Version 3 adds brand quests, Hoppaz for organisers, Card of the Day, and how the game shows up in the app.

Related documents:
- Deck page, where cards get approved: https://claude.ai/artifact/3ZP44yFpm6m96X5UC8PLQL
- Game Plan page (visual, now older than this document): https://claude.ai/artifact/EqKRFDbZ1zQoL8MjNfCroo
- 3D model build: `Hoppaz-3D-Model-Build.md`
- Brand, community and art rules: the `hoppaz-brand-content` skill
- App UI refresh plan and spec: `docs/UI-REFRESH-PLAN.md` in `jaethecreator/hoppaz`, branch `ui-refresh` (handoff notes in `docs/handoff/`)
- Design System Draft (8 Oct 2026) and Mascot Rig v3

## 1. What this is

Hoppaz is a community-first movement in Lagos that runs a party bus. The game is the layer that keeps Hoppers around between Hops. It turns going out into something you collect, show off and compare with people near you.

The one-line pitch: **Duolingo's daily habit, Pokemon GO's collecting, built out of real Lagos.**

Everything below serves one loop:

**Open a box daily → collect Lagos → show it off → go outside to get more → meet people at Hops.**

## 2. Daily habit

### The streak
A day counts when you do any one of:
- open your daily mystery box
- post a home snap (fit check, traffic, your view, your food)

Snaps go to your crew or your followers, not to a public feed.

Graffiti walls were in the first plan and are **archived for launch**. AR walls need physical spots, permission from wall owners and upkeep, which is a lot of work for one extra way to keep a streak. They can return as a later season feature.

### Streak freeze and repair
| | How it works |
|---|---|
| Freezes | 3 free a month, applied automatically on the day you miss, so nobody loses a streak because they forgot |
| After the 3 | Repair within 48 hours with **30 Gist** (the in-game currency) or **₦1,000**. The Gist option is always shown first |
| Limit | 2 paid repairs a month, so a streak still means something |
| Repaired days | Keep the streak alive but never count as an outside day. Nobody can buy their way to a Golden Box |

No countdown timers and no "your streak is dying" alerts pushing the paid option. One calm prompt the morning after a miss, with both options side by side.

**The money rule:** money never buys boxes, cards, odds or outside days. It can only buy back a streak. Payments are 18+ only. On the web, Paystack or Flutterwave keeps the full ₦1,000. If Hoppaz ever ships a native app, Apple and Google require their own billing and take 15 to 30%.

**Watch:** if the same people pay every month, the paid repair is working as a toll rather than a safety net. The fix then is more free freezes, not a higher price.

### The Golden Box
Earned by a 7-day streak, but only if at least **2 of those 7 days were outside**. A day counts as outside when you open a box away from your home spot, or check in at a Hop or a Drop Lab hunt. Staying home keeps the streak. Going out earns the big prize. The Golden Box always gives Epic or better.

## 3. The deck

One catalogue of cards about Lagos: its places, history, music, food, people and lore.

**287 draft cards today:** 12 Legendary, 40 Epic, 86 Rare, 149 Common. Plus 107 reserve ideas waiting to become cards.

### How sets are organised
| Kind | Sets | Cards now |
|---|---|---|
| Council sets, one per local government | 57 (20 LGAs and 37 LCDAs) | 199 |
| City-wide: Music | 1 | 46 |
| City-wide: Nigerian Heroes | 1 | 17 |
| City-wide: Lagos Governors | 1 | 15 |
| Campus series, starting with UNILAG | 1 | 10 |

Every council gets its own set, holding between 10 and 30 cards depending on how many facts can be confirmed. Rich places fill up and small ones never get padded. Ikorodu is six sets, because it is six councils. Every council has at least 2 cards today.

Later city-wide sets: Sports, then Heritage (orishas and festivals) once a cultural adviser is on board.

### Rarity comes from achievement
Not from drop time, not from hype. If someone meets the bar, they get the tier.

| Tier | Copies a season | Who gets it |
|---|---|---|
| Legendary | 10 | Grammy winners, global number ones, music pioneers, a Nobel Prize, major orishas |
| Epic | 100 | National heroes and founding figures, major festivals, national firsts, AFCON winners |
| Rare | 1,000 | Lagos governors, historic institutions and landmarks, club legends |
| Common | Unlimited | Markets, roads, bus stops, food, slang, neighbourhood facts |

**Music classes** (the set with the most people, so it has its own named ladder):

| Class | Tier | Bar |
|---|---|---|
| Grammy Club | Legendary | A Grammy win, or a number one on a global chart |
| Pioneer | Legendary | Founded or defined a Nigerian genre: Fela, King Sunny Ade, Ebenezer Obey, Victor Olaiya, Tony Allen, Sikiru Ayinde Barrister |
| Headliner | Epic | A top Headies prize, three or more Headies wins, or two Nigerian number ones as lead artist |
| Star | Rare | A Headies win, or a Nigerian top 10 as lead artist |
| New Wave | Common | Newer and rising artists, plus songs and music spots. The easy pulls, and the best launch partners |

Featured credits never count toward a chart tier. Cards placed outside these rules are marked "founder's call" on the card, so nobody can say we picked favourites quietly.

### Every card carries
An id, its set, a sourced fact, a lore line, a superpower or what the person is known for, a conversation question on the back, its tier and the reason for that tier, its home area, and flags for sign-off, sensitive content and campaign holds.

## 4. How cards move

| | Rule |
|---|---|
| Box odds | Common 84%, Rare 13%, Epic 2.7%, Legendary 0.3% |
| Home area | Every card has one, where it drops 3 times more often. Wizkid turns up most in Surulere |
| Sold out | When a card's season copies run out, its slot rolls to another card of the same tier |
| Guaranteed | A Rare by your 10th box, an Epic by your 60th. Legendaries are never guaranteed |
| Numbered copies | Every Epic and Legendary is numbered ("S1, 7 of 10"), and the first finder is recorded forever |
| Reprints | Each season reprints with new art, so newcomers still have a shot and Season 1 copies stay special |
| Trading | In person only, both phones within 100 m. One Epic or Legendary trade a day. Trading means meeting |
| Gifting | One spare a day to your crew |
| Gist | Break down a spare: Common 5, Rare 20, Epic 100. Craft a missing Common for 40, a Rare for 200. Epics and Legendaries cannot be crafted or broken down, so they stay earned |
| Foils | 5 copies of a Common fuse into its foil version |
| Finishing a set | 500 XP, a title on your profile ("Akokite", "Yaba Local") and a numbered foil completion card |
| Starting a set | Every album starts with 2 cards already in it |

**Never for money.** Cards and boxes cannot be bought or sold for naira. Paying for random rewards is linked to problem gambling, and cash-out makes it worse.

## 5. Social

- **Profile** in the style of Threads: your streak, how long you have been active, your albums, your titles.
- **Crews:** your people, plus one gift a day. If one member goes out, the whole crew moves.
- **Crew board (proposed):** crews compete on a Lagos board by the share of the crew that went out this week ("3 of 4 out"), so a tight crew of four can top Lagos. Replaces any friends-only XP leaderboard, which ranks friends against each other.
- **Leagues of 30 by neighbourhood,** reset weekly. Small enough that the same faces come back.
- **League pop-ups:** "Your league-mates are at this Hop tonight." This is the bridge from phone to bus.

## 6. The real world

- **Drop Lab** runs the hunts and secret stops, and reveals the venue when the time comes.
- **3D venues** are built automatically from open map data, with no hand modelling. See the 3D model build doc.
- **Hops** are where box drops, trades and league meetups happen. Boarding 6pm, the bus leaves at 7pm and does not wait. Four stops, the last one is the finale, guaranteed ride home.
- **Badges** stay as they are: ride a Hop, collect a badge, 4 badges makes you a Captain.

## 7. Brand quests

The differentiator. Organisers and brands set their own quest lines around their events and fund the rewards; Hoppaz builds the quest line, verifies every action, and adds XP and badges that carry across organisers. Comes after the app UI launch.

### Why it is open ground
Research on 8 October 2026 found no ticketing platform with one self-serve builder for pre-event and post-event quests with brand-funded rewards. What exists:
- Referral cashback, pre-event only, paying for ticket sales: Posh Kickback, Shotgun Cashback, Tixr Rewards, Ticket Fairy, Skiddle Reps. Eventbrite shut its referral credits in January 2024.
- Conference app quest builders, mostly on site: Eventify, Amego, POAP Journey.
- One-off festival builds paid by a sponsor: Coachella Quests (2024, with Avalanche), Defqon.1 The Path, Moongate at TOKEN2049.
- Nothing in Lagos or Africa. Nobody ties post-event quests to verified attendance, and nobody carries XP across organisers.
- Almost every published metric is vendor-reported; treat them as claims.

### Where the model comes from
Jae ran questing at Absinthe Labs for web3 companies. Hoppaz runs questing for social and real life. At Absinthe: follow quests on X and Instagram (sometimes Medium) plus "follow our account"; X checks through the X API ("XABS", to confirm); Instagram through an in-house Airtable-style tool where people submit a screenshot that is confirmed by hand or by AI.

### The quest line
| Phase | Quests |
|---|---|
| Pre-event | Say you're going; follow the brand on X or Instagram (and Hoppaz); like or repost the announcement; share your referral link; bring your crew |
| At the event | Check in (location verified by the server); scan the sponsor's QR; photo tasks set by the organiser ("snap pictures with four people", "snap the DJ"); post on X or Instagram tagging the brand |
| Post-event | Recap photo (only after a verified check-in); rate the night; say you're going to their next one; buy the merch |

Examples: Blockfest runs pre-event follow and repost quests. South Social runs on-the-night photo tasks that make the night livelier while promoting the brand.

### Who does what
- **Brands and organisers:** set the quests and fund the rewards (discounts, merch, drinks, upgrades, tickets). That is on them.
- **Hoppaz:** builds the quest line, verifies actions, tracks referrals for events hosted on Hoppaz, can power ticket rewards, and adds XP and badges on top.

### Verification
| Action | How it is checked |
|---|---|
| Going, check-in, QR scan, referral, in-app photo | Inside Hoppaz (already built for check-in, QR and photos) |
| At-event photo tasks | Photo taken in the app after check-in; a cheap vision model checks the task ("four people", "the DJ") |
| X follow, like, repost, mention | X API (tier and monthly cost to confirm) |
| Instagram post tagging the brand, story mention | Meta's APIs when the brand connects its professional account (to confirm) |
| Instagram follow and like | Screenshot checked by a cheap vision model on Groq against the brand's own reference screenshot; low confidence goes to a review queue |

Still open: the X API tier and price in 2026 (X made likes private in 2024), exactly which Instagram actions Meta's APIs expose, Groq vision models and price per check, and what X's and Meta's rules say about rewarding follows and likes. A brand's account getting flagged for incentivised engagement would land on Hoppaz.

### Guardrails
- Real rewards pay only for verified actions, capped per person. Shares and invites earn XP, not brand rewards.
- Brands deposit reward codes or stock before a quest goes live, the same way drops hold codes today.
- Screenshot checks: the handle must match the linked account, the screenshot must be fresh, near-duplicate images are caught across all submissions, low confidence goes to review, random spot checks, follows re-checked after a few days.
- Fixed rewards for actions. Prize draws in Nigeria need a National Lottery Regulatory Commission permit (MILO and Guinness promotions run under that regime).

## 8. Hoppaz for organisers

Hoppaz becomes a place to list events and keep a crowd, which Eventbrite and Tix don't do: they sell a ticket and forget you. Staged so nothing heavy is built before demand is proven.

| Stage | What |
|---|---|
| A. Claimed event pages | An organiser claims their listing, adds a lineup ("Harry Obi, on the panel") and posts updates (speakers, sponsors). Hoppers tap Follow and see the updates. Tickets still link out. Run with a claim campaign: "Are you a brand or organiser? Claim your event on Hoppaz. DM us." |
| B. Ticket pledge | Organisers give tickets (3 minimum, more buys more placement) that power quests and box prizes across the app. Ticket prizes only drop before the event; unclaimed ones go back. Can be piloted today with the existing drop system, which already supports ticket rewards with codes. |
| C. Native ticketing | Hoppaz sells tickets on its own ticket layer (ticket types, QR tickets, door scanning) over Bachs payments. |

### Pricing
Prices start cheap to pull organisers over. Recommended shape: a **founding organiser rate** (for example 2.5%) locked for 6 to 12 months for the first 20 to 50 organisers, with the end date announced up front, then the standard 4.5% (or 5% with promotion bundled). Avoid 0%. Market: Tix about 5% plus a per-ticket fee, Selar about 4%, Syticks about 3.5%, Posh and Partiful about 10% plus a per-ticket fee. The low rate works because brands fund quest rewards; Hoppaz's fee is not the reward budget.

### Payments: Bachs
Bachs (bachs.io, Jae knows the owner) is payments and billing infrastructure, not ticketing. Its Connect sub-accounts can pay organisers directly. Recommended: the organiser collects into its own sub-account and Hoppaz takes a per-ticket platform fee, so refunds and disputes hit the organiser's balance. NGN available instantly; NGN payouts N50 flat; bank transfer 1.5% capped at N2,000; Nigerian cards 2%. Refunds keep the processing and platform fees, so Hoppaz needs a written refund policy. Clear in writing before integrating: Bachs prohibits "mystery boxes and random pack openings" (Hoppaz's boxes are free, nothing random is sold), event ticketing is not explicitly listed as supported, licence, local card cap, and the Connect production review timeline. Pitch instant naira payouts to organisers loudly.

### Notifications
Organiser updates need push, which on iPhone only works once the app is installed to the home screen. The install sheet comes first; WhatsApp stays the reliable channel.

## 9. Card of the Day

A daily **online content series** on Hoppaz's social channels, not an app feature: iconic cards from the deck, showing what people are enjoying. Only signed, place or public-domain cards are featured. The 89 Season 1 cards without rights appear only as locked silhouette slots with no name or likeness: "A Grammy Club card is waiting for its artist. Is it you? DM us." Same pattern for brands ("If you are a brand and want your card in the deck, DM us"). Check each card's sign-off flag in the deck review before it is posted.

## 10. The game in the app

How the game shows up in the Hoppaz app after the UI refresh (branch `ui-refresh`).
- **Two kinds of rank.** Status from the bus is canon: join and you are a Hopper; 4 Hop badges make you a Captain. It cannot be earned with XP. XP levels have their own names, proposed **JJC, Regular, Plug, Oga, Agba** (pending Jae's final word). No "Bridge Rat", no "Night Runner", no "-er" job names.
- **Map:** a streak chip in the top bar (drawn flame icon, never an emoji) opens "Ways to earn". The map itself stays content: no XP chip, no mascot.
- **Today:** each event card carries its quests and the reward for going.
- **Me:** level name, bus status with badge stamps, two big numbers (daily streak and XP), and tapping XP opens "Ways to earn" (every quest available, like Duolingo). Badges are stamped ticket stubs, not emoji. The Quests page folds into Me.
- **Moments:** check-in punches the event stub; each new badge stamps in (180ms, no bounce); stars fly to the Me tab only for badges, rank changes and drops. The drop reveal (four sealed boxes) is built once and reused for the daily mystery box.
- **Streak today vs the plan:** the app's current daily streak counts any check-in, quest, photo, post, drop claim or crew action. Section 2's rule (open the box or post a home snap) replaces it when the box engine ships; the screen stays the same.
- **Mascot:** allowed at first run, empty states, the drop reveal, badge and rank moments, errors and the month report card, plus small and permanent on Me reflecting how you are doing. Never on the map, the event list or in chat. The rig has 10 states; this plan lists 8 moods in section 11: reconcile.

## 11. The mascot

A rig is built with 8 moods: wink, hype, secret, leaving, celebrate, sleepy, proud, oops. It reacts to the streak, the box, the Golden Box and league results.

Proposed name: **Waka**. Not confirmed. Two things are open: the name, and the brand guide, which currently lists "a rabbit face" as a don't while the mascot is a rabbit. One of the two has to give, and a trademark check is needed before the name is locked.

## 12. How it all syncs

One card catalogue, and everything reads from it:

1. Research, with a source on every fact
2. Review page: Approve or Needs fix
3. Legal check and sign-off
4. Image forge: owned or licensed photos turned into halftone art, about 4 KB a card
5. Drop Lab boxes
6. Your album

One profile across streaks, leagues and Hops. Change a card once and it changes everywhere.

### Images
Card art is the art window only. The frame, name, fact, tier colour and copy number are drawn in code, so a new frame next season does not mean exporting images again.

| Image | Allowed? |
|---|---|
| Shot or owned by Hoppaz, or commissioned with a written licence | Yes |
| Public domain or CC0, checked per file | Yes |
| CC BY, CC BY-SA | Yes, with credit. CC BY-SA means our version carries the same licence |
| CC BY-NC | No, Hoppaz is commercial |
| CC BY-ND | No, the halftone is a changed version |
| Google Images, Instagram, Pinterest, news photos | No, unless the photographer licenses it |

A credit is not permission. Credit only counts when the licence itself asks for it.

**Living people:** no photo and no drawn likeness until they or their team sign off, whatever the photo licence says. Creative Commons covers the photo, never the person's face or name.

**What can be made now without waiting on anyone:** map art for every place card and every set cover, drawn from open map data; 3D renders of real landmark buildings; generated scenery for food and street cards, logged as generated. Sizes land between 1 and 10 KB a card, so a full season is about 5 MB in total and no player ever downloads all of it.

**Later:** players shoot the card. They photograph a place, the best photo becomes the card art, and the photographer is credited on the back and gets a numbered foil.

## 13. Rules that stay on

- **Brand:** no em dashes, no emojis. Colours are Hoppaz Orange, Night Black, Bridge Cream, Third Mainland Violet used sparingly, Ember for shadows. Poppins Black.
- **Politics:** past heads of state and governors are written positive-only, office and dates and one sourced milestone, no praise words and no criticism. Sitting officeholders stay neutral and stop dropping during the 2027 election campaign. No coat of arms and no presidential seal.
- **Sensitive:** sacred rites, coups, the civil war and June 12 are stated as plain dated facts and marked. A cultural adviser reviews the Heritage material.
- **People:** 83 cards need sign-off (living people, companies, estates). Ordinary private people never get a card without consent.
- **Sources:** every fact has a source link. Research could only read search previews, so a human opens the source before approving.
- **Endorsement:** no real person's name in ads or notifications without permission. The app carries a line: "Cards celebrate Lagos history and culture. Being in the deck does not mean a person endorses Hoppaz."
- **Before launch:** one hour with a Nigerian IP and media lawyer, covering endorsement wording, trademark checks on the top 30 names, the consent form for New Wave artists, and the takedown process.

## 14. Build order

| Phase | What | Status |
|---|---|---|
| 0. Foundations | Campus Twin, 3D venues in Drop Lab, mascot rig | Done. Venues are on branch `venues-3d`, not merged |
| 1. Content | 287 draft cards, review page | Drafted, waiting on review |
| 2. Core loop | Box engine, album, card render, daily streak | **Next** |
| 3. Social | Profile, crews, leagues, trading, gifts | After phase 2 |
| 4. Real world | Golden Box outside check, league pop-ups at Hops | After phase 3 |
| 5. Season 1 launch | 16 Season 1 sets at 10+ cards, legal review, sign-offs, art | Runs alongside 2 to 4 |
| 6. Expand | Rest of Lagos, then Nigeria. Each season reprints with new art | Later |
| App UI refresh | Design system across every screen, day and night on the Lagos clock, real logo, day rail, ticket stubs, mascot | In progress on `ui-refresh` (reviewing) |
| Brand quests | Quest builder for organisers and brands, social verification, guardrails (section 7) | After the UI launch |
| Organisers | Claimed pages, ticket pledge, native ticketing on Bachs (section 8) | Stage A after the UI launch; B can pilot now |

## 15. How we know it works

- Share of new players who come back the next day, and after a week
- How long streaks run
- Share of streak days spent outside
- Trades made in person
- Cost per member who becomes a paying rider, not cost per join

## 16. Open items

1. Review the deck, starting with the Season 1 and city-wide sets.
2. Photos: 3 to 5 you own, to build the image forge. The Hoppaz Library is on a Mac that cloud sessions cannot reach, so it needs to go to Google Drive or be uploaded.
3. Tayo Creed's bio and his OK. His card is a placeholder today, since nothing online confirms anything about him.
4. Tensky: the correct spelling or a song, because nothing came up.
5. Mascot name and the brand guide update.
6. Screenshots of hoppaz.vercel.app, which this session still cannot reach.
7. XP level names: confirm JJC, Regular, Plug, Oga, Agba.
8. Social quest verification: X API tier and cost, Instagram API coverage, Groq vision price per check, platform rules on rewarding follows and likes.
9. Bachs: the written confirmations in section 8.
10. Mascot moods: reconcile the 8 moods here with the rig\'s 10 states.

## 17. Where the rules came from

- Streaks and repair: Silverman and Barasch (2023).
- Duolingo: streak freeze, leagues of 30, and a streak wager that lifted day-7 retention by 14%.
- Snapchat streaks for the sense of obligation, and BeReal's decline for what happens when a daily prompt has no reward underneath it.
- Loot boxes and problem gambling: Zendle and Cairns. This is why nothing random is ever sold.
- Hearthstone: dust (our Gist) and pity timers (our guaranteed drops).
- Pokemon GO: 100 m in-person trading, and creatures as the reason people stayed.
- Endowed progress: Nunes and Dreze, where a card starting at 2 of 10 finished far more often than one starting at 0 of 8.

- Brand quests landscape (8 Oct 2026): Posh Kickback, Shotgun Cashback, Tixr Rewards (LIV Golf case study), Ticket Fairy, Skiddle Reps, Eventify, Amego, POAP Journey, Coachella Quests 2024. Referral fraud patterns: ReferralCandy and Viral Loops guides.
- Organiser community landscape: Eventbrite follow and 2025 app, Ticketmaster Watchlist (2026), Posh activity feed, Luma chat and newsletters, Shotgun organiser pages, Whova; Moonshot sells through Mainstack.
- Bachs docs: Connect, platform fees, refunds, fees, supported businesses.

## Change log

- **8 Oct 2026, v3.** Brand quests (section 7) from Jae's Absinthe Labs model, with the research showing nobody offers it. Hoppaz for organisers (section 8): claimed pages, ticket pledge, native ticketing on Bachs, founding organiser pricing. Card of the Day as an online content series (section 9). The game in the app (section 10): bus status vs XP levels, Ways to earn, two number tiles, stamped badges, one reveal screen for drops and the daily box. Crew board proposed. Sections renumbered.
- **8 Oct 2026, v2.** Graffiti walls archived for launch. Streak freeze set at 3 free a month, then 30 Gist or ₦1,000, with repaired days never counting as outside days. Music classes added, with Pioneer for the genre founders and New Wave for rising artists. Epic tightened. Heads of State set removed from the deck and archived. Political cards set to positive-only for past leaders, neutral for sitting ones, with a campaign hold. Image licence rules written down. Deck at 287 cards across 61 sets.
- **7 Oct 2026, v1.** First game plan: streaks, mystery boxes, the card deck, leagues of 30, the mascot rig, the economy and the rarity ladder.
