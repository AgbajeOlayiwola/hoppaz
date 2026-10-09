# Gamify next: more fun, less muddled

9 Oct 2026. A review of the app as it is today, on branch `ui-refresh`. Jae asked how to make it more fun and interactive, and said the sound is good but "not really doing much yet". Jae's rows in `docs/DECISIONS.md` win over anything here. Nothing in this file is built. It is a list to pick from.

How to read it: size S is under half a day, M is one to three days, L is longer or needs Ola's server work. "Where" names the file to open first.

## 1. What I saw when I played it like a new Hopper

I ran the app at 390 by 844 in a fresh headless browser (no account, Lagos location granted), then read the sound and intro code. A headless browser cannot hear, so I counted Web Audio sources that started at each step. Signed-in Me, Crew and quest screens I read from the code and from earlier review shots, because a guest hits a sign-up wall there.

| Step | What happened | Sound |
|---|---|---|
| Title sequence | Plays on first open. Tap skips it. A sheet then asks for your location and covers the map, so Paz waits behind it until you close it. | none |
| Paz, steps 1 to 4 (welcome, install, face) | Good card, good mascot, a progress bar and "01 / 16". | none |
| Tap your face, enter Play | The talking drum "call" plays. 16 sound starts. | yes |
| First welcome box, the four sealed boxes | Pick, drag the tape, "You got 50 XP". Three small buzzes. | **none** (0 starts) |
| Close that box | The XP flies to the bar. | yes, only now |
| Second welcome box | The full open moment: rip, drum by tier, shekere, chime, XP fill. | yes |
| Paz says "XP and a collectible, just like that" | The welcome box paid XP only. The line is wrong (see item 3). | none |
| Today deck | Looks great. Slide, tap, "I'M GOING". Guests get the sign-up sheet. The agogo tick is in the working tree, not committed yet (`src/components/today/tick.ts`). | tick only |
| Crew, Me | A guest who has won XP sees a blank sign-up wall. Nothing says what they won. | none |
| Chat | Quiet. Waves are polled every 30 seconds (`src/lib/chat.ts` near line 298). No sound, no dot. | none |

What this says:

1. All the sound lives in the Play open moment. The rest of the app is silent, including the very first reward a Hopper gets.
2. The best moments (check-in stamp, quest done, WE OUTSIDE, level up, streak kept) are quiet. They are a toast or a 180 ms stamp.
3. Two voices were built and never used: `danfoHorn` (its comment says "Hop bus near") and `coin`.
4. Mute exists only as the speaker button inside Play (`src/components/play/Hud.tsx` near line 105). There is no row in Me, and no volume.
5. Level up exists only inside the Play open stage (`src/components/play/open/engine.ts` near line 263). XP from a check-in or a quest can cross a level and nothing happens.
6. The game does not carry through the tabs. Play feels like a game. Today, Crew, Me and Chat feel like a different app.

## 2. Rules that keep it from getting muddled

Jae hates muddled. These hold for everything below.

1. **One moment at a time.** If three things happen at once (check-in, badge, level up), they play in order, one on screen, or fold into one line ("+130 XP, 2 stamps"). Order: level up, streak milestone, badge, check-in, quest, streak kept.
2. **Stamps, not confetti.** The app's own motion is the stamp (180 ms, no bounce). Keep it. The big extravagance stays the box reveal.
3. **A reward you can name.** Every celebration says what you got in four words or fewer. No mystery meters.
4. **Going out pays most.** Do not add anything that makes the couch pay better than the street.
5. **No new tabs, no new currency, no new chrome on the map.** The map stays content (Game Plan, section 10).
6. **Paz is allowed in:** first run, empty states, the box reveal, badge and level moments, errors, the recap. Not on the map, the event list or in chat.
7. **No guilt.** No countdown timers on streaks, no "you are about to lose it", no red. The one allowed timer is the real Hop bus leaving.
8. **Every sound has a visual twin.** Nothing is only heard.

## 3. Top 10 quick wins

All are size S. Together they make the app feel alive without adding one new screen.

| # | Quick win | Why it is fun | Where |
|---|---|---|---|
| 1 | **Make the first box loud.** The four-box reveal gets a click on pick, a rip on the tear, the Common drum when the card comes out, a count-up on the "50" and a flip on flick. | Pokemon GO's first catch is its best sound. Your first reward should not be silent. | `src/components/reveal/Reveal.tsx`: `pick` (near 105), `finishTear` (near 120), the `pulled` effect (near 130), `next` (near 134), `PulledCard` (near 432). Hold `sfx.acquire()` while it is mounted. |
| 2 | **One app-wide sound lane, plus a Sound and Buzz switch in Me.** Today sound only runs inside Play or on a lease. Add one app flag so quiet UI sounds work on every tab, behind one switch. | Duolingo's ding on every correct answer is why the app feels alive. | `src/lib/sound/sfx.ts` (`isActive`, `setPlaying`, `acquire`), `src/components/me/SettingsGroup.tsx` (new rows), mount in `src/app/layout.tsx`. |
| 3 | **The Hoppaz three notes on Paz's first tap, and a soft tick on each tour step.** Also fix the line that promises "a collectible". | The first sound a Hopper hears should be the brand. The tour then feels like a game, not a form. | `src/components/intro/IntroCard.tsx` (step change), `src/components/intro/IntroHost.tsx`, `src/lib/intro/lines.ts` (`box2` says "XP and a collectible" but welcome boxes pay XP only, per `docs/PLAY-MODE.md` section 1). |
| 4 | **Check-in lands with a stamp sound and a buzz.** Stamp, short motif, 30 ms buzz, the "+100 XP" counts up. | Check-in is the main thing the whole game wants you to do. It is the quietest moment today. | `src/components/event/CheckInBlock.tsx` (`landing` branch), `src/lib/useCheckin.ts` (the `ok: true` return). |
| 5 | **Quest done is a stamp on the row, not a toast.** | Clash Royale's chest tap and Duolingo's quest tick both live on the thing you tapped. | `src/components/EventQuestList.tsx` `complete()` (near 83 to 97), `src/components/me/WaysToEarn.tsx` (DONE pill). Use the unused `sfx.coin`. |
| 6 | **WE OUTSIDE gets the crowd "ehn".** A short version of the crowd voice, a fill on the button, a buzz. | It is the brand's own phrase. Saying it should feel like a crowd answering. | `src/app/discover/page.tsx` `weOutside` (near 291), `src/components/event/GoingFoot.tsx`, `src/lib/useGoing.ts`, `src/lib/sound/sfx.ts` (new `ehn(small)`). |
| 7 | **Streak kept: a once-a-day pop.** The first streak action of the day pops the flame chip, plays a warm agogo and stamps the Me dot. | Duolingo's streak flame is the whole habit. A quiet daily "kept" beats a loud loss screen. | `src/components/map-chrome/TopChrome.tsx` (chip, near 70), `src/components/me/NumberTiles.tsx` (`stamp.streak`, already there), detect from `useGameDashboard` in `src/app/page.tsx` (near 77). |
| 8 | **Level up outside Play.** Cross a level from a check-in or a quest and get the same "LEVEL UP: REGULAR" pill, the crowd "ehn", a buzz and a Share to story. | Levels are the Duolingo league feeling. Today they only fire in a box. | `src/lib/useSession.ts` (watch `profile.xp` with `levelFor` in `src/lib/brand.ts` near 52), a small `src/components/LevelMoment.tsx`. Sound and pill is S. |
| 9 | **A guest's wall shows what they won.** "250 XP, 3 boxes, day 1. Make an account to keep them." | Endowed progress (Game Plan, section 17): people finish what they have already started. Matches "Sign up to keep your Golden Danfo". | `src/components/app/AccountWall.tsx`, `src/components/app/RequireAccount.tsx` (Crew and Me), numbers from `useWelcomeBoxes` and the session. |
| 10 | **A wave pings you.** New wave while the app is open: a chime, a buzz and a dot on the CHAT tab. | Snapchat's best loop is "someone sent you something". Waves are the start of crews. | `src/lib/chat.ts` `useInbox` (near 295, new wave ids), `src/components/BottomNav.tsx` (dot). |

Close behind, also S: the danfo horn on a Hop night (section 9, H2), the box-alert buzz pattern (section 5.5), and the Hotspot enter sound (section 5.2).

## 4. The full list, in order

P1 is the top 10 above plus the sound work in section 5. P2 is the next pass. P3 waits on the card deck, Hotspots or Ola's server work.

### P2: next pass (size M)

**M1. A moments queue.** One tiny queue so level up, badge, check-in and quest never stack. Folds same-tap results into one line. This is the guard against muddle and everything in P1 sits on it. `src/lib/moments.ts` (new), read by `LevelMoment`, `CheckInBlock`, `EventQuestList`. Borrowed from: Duolingo's end-of-lesson screen, which orders XP, streak and quest in one sequence.

**M2. Tonight's three (daily quests).** Three small rows at the top of Today: say WE OUTSIDE on one event, check in, post one snap. Three dots fill as you go. The "Be out tonight" daily (+50) and "Out twice this week" weekly (+100) already exist, so this is mostly showing them. Duolingo shows three daily quests and a chest at the end. Pay the existing XP, add no new currency. Where: `src/app/discover/page.tsx` header, `useQuests` in `src/lib/game.ts`, `src/components/me/WaysToEarn.tsx`. Size M (progress needs a server read for "1 of 2").

**M3. The night as a punch card.** On an event, quests are punches on the stub, in the order the night goes: before (WE OUTSIDE), at (check in, code, photo), after (recap, rate). The stub fills left to right and the last punch stamps the whole stub. This is the Game Plan's quest line (pre, at, post) drawn as the ticket stub the app already is. Where: `src/components/EventQuestList.tsx`, `src/components/event/StubSheet.tsx`, `src/components/today/EventStub.tsx`.

**M4. First night ladder.** One short list for a new Hopper: three boxes (done by the tour), WE OUTSIDE, check in, make a crew, share a story. The three welcome boxes pay 250 XP (50, 50, 150), and Regular starts at 500, so the first level up is one check-in and a quest away. Say that out loud in Me: "250 of 500 to Regular". A badge called Day One at the end. Pokemon GO's early research tasks do this job. Where: `src/components/me/NumberTiles.tsx` copy, a card at the top of `src/app/me/page.tsx`, the last Paz line in `src/lib/intro/lines.ts` (`me`).

**M5. Weekly recap, Sundays.** The app already makes a month card ("Your September is ready", `src/components/me/MonthCard.tsx`). Add a Sunday "Your week": seven dots, nights out, XP, Paz proud (`state="win"`). It is a calm way to show a streak, with no loss in it. BeReal's memories and Spotify's wrap are the model. Share to story from it.

**M6. Crew tonight meter.** On the Crew page and on Today cards: "2 of 4 out tonight", faces for the ones who said WE OUTSIDE. This is the Game Plan's crew board, drawn small. Needs the one small DB addition Jae already listed for crew faces on events. Where: `src/app/crew/page.tsx` (the board near 59 and 289 is an XP list today), `src/components/today/DeckCard.tsx`.

**M7. Crew board resets Monday.** Crews ranked by the share that went out this week (decided: Go). A Monday card shows last week's podium. Duolingo leagues of 30 with weekly reset are why people check back. Keep it check-ins only so linking up cannot raise a rank (`docs/PLAY-MODE.md` section 7). Where: `src/app/crew/page.tsx`, a server view.

**M8. Night combo stamp.** In one night, do three different things (WE OUTSIDE, check in, one quest or photo) and the stub gets a "Full night" stamp. Pays one fixed small XP once per night and a badge once. It is a stamp, never a multiplier, so XP numbers stay Jae's. Where: server rule, client in `CheckInBlock.tsx` and the stub.

**M9. Crew combo.** The existing group quest ("Show up with two of your crew", +80) gets a live "2 of 3 here" meter on the event sheet, and a stamp when the third arrives. `src/components/EventQuestList.tsx`, `src/lib/game.ts` (`group_not_there`).

**M10. Share more things to story.** "Share to story is sick" (Jae). Reuse the 9:16 image maker for a level up, a streak milestone, a badge, a Hop ridden. `src/components/today/story.ts`, `src/components/today/StorySheet.tsx` (both new in the working tree).

**M11. Weekly ladder.** One slim bar on Me: out 1, 2, 3 nights this week, each rung a stamp. "Out twice this week" already pays +100. Monopoly GO's milestone ladder, but with three rungs, not twenty. Where: `src/components/me/NumberTiles.tsx` week dots.

### P3: after the deck, Hotspots or Ola's work (size L)

**L1. Visited stamps on place cards.** Stand at the place, the card stamps Visited with the agogo stamp sound (spec in `docs/CARDS.md`). Pokemon GO's visited stops, Nomad List's places. Needs Ola's tables.

**L2. A catalogue screen.** Every collectible as a silhouette, "???" until found. The Me shelf already draws locked tiles. Open item in `docs/DECISIONS.md`.

**L3. First-of-a-tier fanfare.** The first Rare, Epic and Legendary you ever pull each get a named line from Paz and their own drum phrase (the phrases exist: `rare`, `epic`, `legendPhrase`). S once the deck is live, because it only needs a "first time" flag per tier.

**L4. Night snap.** One optional prompt on a night you are checked in: "Snap the night". It goes to your crew only. No countdown, no penalty if skipped. BeReal's idea without its guilt. Where: `src/components/event/Photos.tsx`, push in `public/sw.js`.

**L5. Set rings and "2 starters free".** From `docs/CARDS.md`: every album starts with 2 cards, and a ring shows progress. Endowed progress again.

## 5. SOUND

### 5.1 What plays today

23 voices in `src/lib/sound/sfx.ts`, all generated with Web Audio (no files, zero bytes). Everything pitched sits in D major pentatonic (D E F# A B).

| Voice | Called from | When |
|---|---|---|
| `talkingDrum("call")` | `src/components/play/PlayLayer.tsx` (near 305) | you enter Play |
| `talkingDrum("exit")` | `PlayLayer.tsx` (near 319) | you leave Play |
| `rise` | `PlayLayer.tsx` (near 239) | a new box appears near you |
| `agogo(0)` | `PlayLayer.tsx` (near 382) | you come into reach of a box |
| `knock` | `PlayLayer.tsx` (near 643) | you tap a far box |
| `rip`, `swish`, `shekere`, `hush` | `src/components/play/open/engine.ts` (362, 427, 513, many) | the box opens |
| `talkingDrum(tier)` and `legendPhrase` | `engine.ts` (near 427) | the burst, by tier |
| `chime(i)`, `fly` | `engine.ts` (322, 329) | rewards fan out and fly |
| `fill` | `engine.ts` (253) | XP lands in the bar |
| `crowdEhn` and `sparkle` | `engine.ts` (263) | level up (Play only) |
| `stamp` | `engine.ts` (277) | the streak pip lands |
| `click`, `flip`, `tick` | `engine.ts` | card lands, card flip, count-up |
| `agogo(3)` | `src/components/today/tick.ts` (uncommitted) | the Today deck snaps |
| `danfoHorn`, `coin` | nowhere | never called |

Rules already in the file that stay: the context is made only inside a real tap, at most 6 voices at once, a failure is logged and never thrown, mute is saved in `localStorage` under `hz-sound`, and the context is suspended outside Play so the app does not hold the phone's audio.

### 5.2 Where sound is missing, and what to put there

| Moment | Today | Add | Lane | Buzz | Where |
|---|---|---|---|---|---|
| First welcome box (four sealed) | silent | click, rip, Common drum, count-up, flip | Moment | 8, 18, 6 (already) | `Reveal.tsx` |
| Intro, Paz first tap | silent | the three notes | Moment | none | `IntroCard.tsx` |
| Intro, each step | silent | one soft tick; a short chime when a step finishes | UI | none | `IntroHost.tsx` |
| Title sequence | silent | none. A browser blocks sound before a tap. Play the three notes on the first tap that follows. | | | `TitleSequence.tsx` |
| Tab switch | silent | a very quiet wood tick, one pitch per tab (D, F#, A, B, E up the scale) | UI | none | `BottomNav.tsx` |
| Toast | silent | tick for neutral, soft chime for ok, a low knock for error. Nothing for "Link copied". | UI | none | `src/lib/store.ts` `say()`, `Toaster.tsx` |
| Check-in | 180 ms stamp, silent | stamp plus short motif, "+100 XP" counts up | Reward | 30 | `CheckInBlock.tsx` |
| Badge stamped | silent | agogo stamp per badge, 220 ms apart (the visual already staggers) | Reward | 25 | `CheckInBlock.tsx`, `BadgeShelf.tsx` |
| WE OUTSIDE | silent | the short crowd "ehn" | Reward | 10, 30, 14 | `discover/page.tsx`, `GoingFoot.tsx` |
| Quest complete | toast, silent | coin (the unused voice), stamp on the row | Reward | 12, 40, 12 | `EventQuestList.tsx` |
| Streak kept | silent | warm agogo, then on day 7 the full motif and the Golden Box drum | Reward | 10, 30, 18 | `TopChrome.tsx`, `NumberTiles.tsx`, `Pips.tsx` |
| Level up outside Play | none | crowd "ehn", sparkle, motif | Moment | 20, 40, 30 | `useSession.ts`, `LevelMoment.tsx` |
| Hotspot entry | not built | two soft agogo notes, a low drum under; a tiny click when someone joins; a falling pair on leave | Reward | 14 | the Hotspot build |
| Someone waves at you | silent, 30 s poll | chime; accepted link up gets the motif ("crew formed") | Reward | 8, 40, 8 | `chat.ts`, `BottomNav.tsx` |
| Hop bus near, boarding, stop, finale | silent | `danfoHorn` short, short, long | Moment | 60, 50, 60, 50, 200 | `NextBar.tsx`, `NightMap.tsx` |
| Box alert push, app closed | OS default | a vibrate pattern only (short, short, long) | | same | `public/sw.js` `showNotification` |
| Push arrives, app open | nothing | a chime (the service worker already messages open windows: `hoppaz:push`) | UI | none | `public/sw.js`, `src/lib/push.ts` |
| Deck slide | tick only in the working tree | keep; add a lower tick going back (already written) | UI | 6 | `today/tick.ts` |
| Crew move "I'M IN" | silent | agogo tick as the count rises | UI | none | `CrewPanel.tsx` |
| Vibe sticker received (Play phase 5) | not built | one tiny sound per sticker, soft | UI | none | Play heads |

### 5.3 A small sonic identity: the Hoppaz three

Three notes, rising, on the agogo bell, in the key we already use.

- **Notes:** D5, F#5, A5. That is a D major triad, steps 5, 7 and 8 of the existing `pen()` scale (`pen(5)`, `pen(7)`, `pen(8)`).
- **Rhythm:** short, short, long, about 120 ms, 120 ms, 420 ms. That is the danfo horn's own rhythm, so the motif and the bus horn belong together.
- **Under it:** one low talking-drum stroke on D3 (146.8 Hz, already in the drum phrases) landing with the last note.
- **Voices used:** three `bell` calls and one `stroke`. All exist. No new instrument.

Four forms, so it never gets tired:

| Form | Shape | Used for |
|---|---|---|
| Full | three notes, drum, a short shekere shake | Paz's first tap, level up, a 7-day streak, a Hop finale |
| Short | the last two notes only (F#5, A5) | check-in, quest done, link up accepted |
| Fall | A5, F#5, D5, falling | leaving Play, leaving a Hotspot (it matches the existing drum "exit") |
| Day ladder | the last note rises one pentatonic step each day of the 7 pips | the Me streak stamp |

Rules for the motif: it is the signature, so it never plays more than once every 8 seconds, and never twice in one moment.

### 5.4 Volume, mute, quiet hours, iPhone

**Lanes.** Three, so nothing fights.

| Lane | Priority | Level (against today's master 0.7) | Examples |
|---|---|---|---|
| Moment | 3 | full | box open, level up, motif, danfo horn |
| Reward | 2 | about 60% | check-in, quest, streak, wave |
| UI | 1 | about 30% | tab tick, toast, step tick, deck tick |

Implement by giving `voice()` in `sfx.ts` a lane that sets its priority and scales its output gain. It already drops the lowest priority, oldest voice first.

**Rules.**

1. One Moment at a time. While a Moment plays, UI sounds are skipped, not queued.
2. The same sound is never retriggered inside 120 ms. The UI lane plays at most four sounds a second.
3. No music, no looping ambience, no sound on scroll, map pan or typing, and none while the page is hidden.
4. Mute is one switch, saved as `hz-sound`. Show it in two places: the Play speaker (already there) and a new Sound row in Me, Settings. Both change the same value, and the Today tick already follows it because it goes through `sfx`.
5. A separate Buzz switch for haptics, default on.
6. Default is sound on, because Jae likes it. The first sound after install is on a tap, never on load.
7. **Quiet hours.** Use the same window as push (23:00 to 07:00 Lagos, one setting). In those hours the master drops to half and the crowd "ehn", the shekere and the horn are skipped. A person in bed does not get a crowd.
8. Suspend the audio context after about 15 seconds of silence and wake it on the next tap (it already wakes on a gesture). That keeps the phone's battery and audio session free now that sound runs on every tab.
9. Low-end phones (`deviceTier()` is "low", `src/lib/deviceTier.ts`) skip the noise-heavy voices (shekere, ehn) and use plain tones.
10. On iPhone the silent switch should keep the app silent, because Web Audio follows it. Check on a real phone before launch.

### 5.5 Haptics on Android

Android Chrome can vibrate (`navigator.vibrate`). iPhone Safari cannot, so on iPhone the sound and the picture carry every moment, as the code comments already say. Do not build an iPhone haptic workaround.

Today the app has three separate `buzz` helpers (`Reveal.tsx` near 34, `engine.ts` near 49, `today/tick.ts`). Replace them with one file, `src/lib/haptics.ts`, with named patterns. Values in milliseconds:

| Name | Pattern | Used for |
|---|---|---|
| `snap` | 6 | deck snap, small taps |
| `pick` | 8 | choosing a box |
| `stampSmall` | 25 | a badge stamp, a pip |
| `checkin` | 30 | check-in landed |
| `quest` | 12, 40, 12 | quest done |
| `outside` | 10, 30, 14 | WE OUTSIDE |
| `streak` | 10, 30, 18 | streak kept |
| `wave` | 8, 40, 8 | a wave arrives |
| `hotspot` | 14 | enter a Hotspot |
| `levelUp` | 20, 40, 30 | level up (already in the engine) |
| `horn` | 60, 50, 60, 50, 200 | the Hop bus; also the push `vibrate` option in `public/sw.js` |

Rules: only after the person has touched the screen (`navigator.userActivation.hasBeenActive`, as `tick.ts` already checks), never while the page is hidden, at most one buzz every 400 ms, no pattern over 400 ms except the horn, none for tab switches or scrolling, and the Buzz switch turns all of it off.

### 5.6 Sound build order

1. `sfx.ts`: lanes, the app flag, the motif, `ehn(small)`, `buzz` file. (One sitting, no screen changes.)
2. Settings rows (Sound, Buzz).
3. Reveal (first box), Paz, check-in, quest, WE OUTSIDE. These are the top 10 items 1 to 6.
4. Streak, level up, wave ping.
5. Tab ticks and toasts last, because they are the easiest to overdo. Listen with a friend. If anyone says "what was that", turn it down.

## 6. More ideas by theme

Each is one line of what, why, size and where. Anything not in the top 10 or P2 is here.

### Daily and weekly quests

- **Quest rows show progress.** "1 of 2 this week", not a flat list. Duolingo's quest bars. M. `WaysToEarn.tsx`.
- **A "do this now" nudge on the map chip.** Tapping the flame already opens Ways to earn. Add one top line there: "Open a box or check in to keep today". S. `WaysToEarn.tsx`.
- **Quest rewards stay XP and stamps**, never boxes or cards (Game Plan: money and odds never mix with quests).

### Combos

- **A combo you hear, not a number.** Open a second and third small box inside one session and the chime steps up the scale (`chime(i)` and `tick(k)` already step). No bonus, no meter, nothing to explain. S. `engine.ts`.
- Night combo (M8) and crew combo (M9) above.

### Collection moments

- **A "NEW" dot on the Shelf tab and tile**, and a flip when you open it. `src/components/me/ShelfStrip.tsx`, `src/lib/useCollectibles.ts`. S.
- **Camera hunt set**, "0 of 5" on Me today. Give each find a small stamp-in and the agogo `stamp`. S. `src/components/Hunt3D.tsx`, `ShelfStrip.tsx`.
- **The 100th box.** A crowd chant and a story card. Rare, so it feels like luck. S.
- Visited stamps (L1), catalogue (L2), tier firsts (L3), set rings (L5) above.

### Social moments (crew)

- **Link up accepted** is the moment a crew is born. Give it the short motif and a Paz "win". S. Play phase 5 and `src/app/crew/page.tsx`.
- **Crew move RSVPs tick up** with the agogo (`CrewPanel.tsx`). S.
- **Crew faces on events** (needs the DB addition Jae listed). M.
- **Night snap** (L4), crew meter (M6), crew board (M7) above.
- Keep crews private: no map dots, no home area, no distance (`docs/PLAY-MODE.md` section 10).

### Surprise and delight

- **Paz says it a different way each time.** Three or four variants per moment, picked at random, so "Lucky you!" is not the same line every box. S. `src/lib/intro/lines.ts` (pool) and the reveal.
- **Lagos calendar skins.** Friday, Detty December, Independence Day, Sallah, New Year: a small Paz outfit and a cosmetic box tint. No change to odds or rewards. M. `src/components/Mascot.tsx`, `src/components/ThemeClock.tsx`.
- **Time-of-day sound.** Morning opens are lighter (shekere only), night opens carry more drum. S. `engine.ts`.
- **Paz easter egg.** Tap her seven times on Me and she does the dance with a drum phrase. S. `SpotMascot.tsx`.
- **Birthday.** Me already asks for a birthday (`src/app/me/page.tsx` near 359). On the day: a Paz line and a small gift box that pays XP only. S.

### Streak drama without guilt

The Game Plan says no countdowns and no "your streak is dying" alerts. Drama comes from anticipation, not fear.

- **Flame has two warm states, never a cold one.** Lit when today is done, a soft ember when it is not yet. Never grey, never red. S. `TopChrome.tsx`, `NumberTiles.tsx`.
- **Anticipation lines.** Day 6: "Golden Box tomorrow." The Play tray already has "Outside days 1 of 2". Copy only. S. `Pips.tsx`, `Hud.tsx`.
- **Milestones at 3, 7, 14, 30, 60, 100.** The motif ladder, a Paz "win", a Share to story card. M.
- **One calm "welcome back" after a miss**, with a small box. The Game Plan allows one calm prompt the morning after. Freezes and paid repair are on hold (Jae), so say nothing about them. S.
- **Weekly recap** (M5) so the week is something you keep, not a chain you can break.

## 7. The Hop bus as a live event

The Hop is the best real-world moment Hoppaz has, and today it is a map marker that says "AT STOP 1". The position is an estimate from the schedule (`src/lib/busPosition.ts`), because there is no tracker. Everything below must say "estimate" until there is one.

| # | Idea | Why it is fun | Size | Where |
|---|---|---|---|---|
| H1 | **A live Hop card on the map** on the Hop's own day: "Boarding 6pm. Leaves 7pm. It does not wait." with a real countdown. This is the one allowed timer, because the bus is real. | Pokemon GO raids: a time, a place, a crowd. | M | `src/components/map-chrome/NextBar.tsx`, `busPosition.ts` (`phase: "live"`) |
| H2 | **The danfo horn.** Short, short, long when boarding opens, at departure and at each stop, while the app is open. The voice is built and unused. | Everyone in Lagos knows that horn. | S | `sfx.danfoHorn`, `NextBar.tsx`, `NightMap.tsx` |
| H3 | **Four stops, four punches.** A check-in at each stop punches the Hop stub. Stop XP is already decided (250). Blocked on Ola's server-checked boarding function (`docs/PLAY-MODE.md` section 18), because `hop_riders` is not safe to trust yet. | A punch card you can see filling is the Duolingo path. | L | `src/components/HopSheet.tsx`, `StubSheet.tsx` |
| H4 | **A bus room.** While the bus is at a stop, the staff-lit spot there becomes a small room with a live count ("14 on the bus"). Staff-lit spots already work. | The Play "small meta room" idea, with a real reason to be in it. | M | Play phase 4 and 5 (`docs/PLAY-MODE.md` sections 4 to 6) |
| H5 | **The finale.** The Hop badge stamps (180 ms), one crowd "ehn", Paz proud, a Share to story ("I rode the Hop"), and "2 of 4 to Captain". Four Hop badges make a Captain already. | The reward is status, not points. It is the real top rank. | M | `src/components/me/BadgeShelf.tsx`, `src/lib/brand.ts` (`CAPTAIN_HOPS`) |
| H6 | **Alerts that match the horn.** "Boarding in 30 minutes" push with the horn vibrate pattern on Android. | A push that sounds like the bus. | S | `public/sw.js`, `docs/PUSH.md` |

## 8. What NOT to add

Each of these would make the app muddled, or break a rule Jae has already set.

1. **A second currency or shop.** Gist is not built and not needed. XP and stamps are enough.
2. **Daily login calendars** (30 days, bigger prize each day). They reward opening the app, not going out.
3. **Streak countdown timers, red flames, "streak at risk" pushes.** Against the Game Plan.
4. **A public global leaderboard.** Crew board and neighbourhood leagues only. A global top ten shows most people they are far behind.
5. **A friends XP leaderboard.** The Game Plan replaced it with the crew board on purpose.
6. **A battle pass, seasons and tiers** before the deck exists. Too much to explain.
7. **Mini games** (a tap game, a quiz) inside the app. The game is the city.
8. **Anything that sells odds, boxes or cards.** Money only ever buys a streak back, and that is on hold.
9. **Sound on every tap and scroll, or any background music.** It tires people fast. Keep to the three lanes.
10. **Two celebrations at once.** The moments queue (M1) is not optional.
11. **Confetti on every action.** Stamps are the language. Save the big burst for the box.
12. **Paz everywhere.** She stays out of the map, the event list and chat.
13. **Emoji or rainbow badges.** Drawn icons only (brand rule).
14. **Auto-play sound on load, or a sound you cannot mute.**
15. **Chat reactions that pay XP.** It turns chat into farming.
16. **More chrome on the map.** No XP chip, no mascot, no extra buttons.
17. **New tabs.** Five is the limit.

## 9. Suggested order

1. Sound foundation (5.6 step 1 and 2) and top 10 items 1 to 3. One day. The app starts to sound like a game.
2. Top 10 items 4 to 7. One to two days. The main loop (WE OUTSIDE, check in, quest, streak) all feel good.
3. Top 10 items 8 to 10, then M1 (the moments queue) before anything else is added.
4. M2 to M5 (tonight's three, punch card, first night ladder, weekly recap).
5. Hop night: H2 and H6 first (cheap), then H1 and H5.
6. Crew meter and board (M6, M7) with the board work already marked Go.
7. P3 items as the deck, Hotspots and Ola's server work land.

Questions for Jae, only if you want to change the defaults:

1. Is "the Hoppaz three" (D, F#, A with the danfo rhythm) the right sound, or should it be four notes?
2. Quiet hours for sound: same as push (23:00 to 07:00), or just the crowd and horn?
3. Should a guest's first WE OUTSIDE work before sign-up, like the welcome boxes? (Your current call is that Ola's gate stays for everything except the first boxes. I have not suggested changing it.)

## 10. Sources

- Play-through, 9 Oct 2026, at 390 by 844 on the production build at port 3100. Screens in the session scratchpad under `shots/gamify`.
- `docs/PLAY-MODE.md`, `docs/Hoppaz-Game-Plan.md`, `docs/DECISIONS.md`, `docs/INTRO.md`, `docs/CARDS.md`, `docs/PUSH.md`.
- `src/lib/sound/sfx.ts` and every `sfx.` call (list in 5.1), `src/lib/intro/lines.ts`.
- The approved Play mocks and Today mock (session scratchpad `playmode`, `todaymock`).
- Games borrowed from: Duolingo (streak, daily quests, leagues, sound), Pokemon GO (collection, raids, visited stops), Clash Royale (chest taps, tier reveals), Monopoly GO (milestone ladders, set albums), BeReal (a shared moment, a recap), Snapchat (a signal from a friend).
