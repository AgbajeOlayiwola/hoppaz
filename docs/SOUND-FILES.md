# Sound files

The app's sounds are the Web Audio synth in `src/lib/sound/sfx.ts`. A voice can be swapped for a recorded file made with the ElevenLabs Sound Effects API. The synth stays as the fallback, so with no file picked the app still sounds. Sound review and the moments: [GAMIFY-NEXT.md](GAMIFY-NEXT.md) section 5.

## What the files are

| Where | What | Size |
|---|---|---|
| `public/sfx/try/` | 36 cues, 3 takes each (108 files, WAV up to 0.4 s, MP3 above) and `manifest.json`. For listening. The app never requests it. | 1.3 MB |
| `public/sfx/` | The picked takes, one per picked cue, named `<cue>.mp3` or `<cue>.wav`. | 3 to 22 KB each, about 0.4 MB for the 23 picked |
| `src/lib/sound/picks.ts` | One row per voice: which file it plays (or `"synth"`), its trim `g`, and the `aim` the trim comes from. | |
| `src/lib/sound/samples.ts` | Loads the picked files. Holds each sound's lane and, for the stepped ones, its own pitch (`base`). | |

`try/` sits in `public/`, so it deploys. Before launch, decide whether it stays (1.3 MB of static files nothing requests).

## How the app plays them

- Every `sfx.x()` call looks up its key in `picks.ts` (`talkingDrum:common`, `agogo:0`, `coin`). If a file is picked and decoded, it plays as a voice like any other: same lane, master gain, low-pass and compressor, the same 6-voice cap, and the same mute (`hz-sound`) and quiet-hour rules. Hidden page: nothing sounds. Callers do not change.
- If nothing is picked, the file is not decoded yet, or it failed, the synth voice plays.
- Nothing is fetched on page load. The first real tap or key press, on any screen, makes the audio context and starts the load: four files at a time, decoded with that context (a script's `click()` does not count). Muted, nothing loads. A sound that fires before its file is ready plays the synth, so the very first sound after that tap can still be the synth; every one after it is the file.
- A file that fails (404, network, cannot decode) is logged once as `sfx sample <file> ...`, never thrown, and that sound stays on the synth for the visit.
- `renderOffline` renders the synth in its lane. Give it a function and `{ samples: true }` to render the picked file through the same chain (dev only).

### Lanes

Every sound belongs to one lane, the cue's lane in `manifest.json`. The lane sets the voice's priority and its output gain (`LANES` in `sfx.ts`).

| Lane | Priority | Level | Examples |
|---|---|---|---|
| Moment | 3 | full | box open (drums, rip, swish, shekere), level up (ehn, sparkle), enter Play, the full motif, the horn |
| Reward | 2 | 0.6 | chime, fly, fill, stamp, coin, check-in, WE OUTSIDE, wave, Hotspot, the short motif, the exit drum, rise, agogo 0 |
| UI | 1 | 0.3 | click, flip, count-up tick, knock, agogo 3 (the tick when sound is turned on), alert, toast, vibe, tab tick |

The shekere is a bed at priority 0: dropped first, and `hush()` cuts it.

- One Moment at a time: while a Moment sounds, UI sounds are skipped, not queued. Rewards still play.
- The same sound never retriggers inside 120 ms. A sound is a cue plus its first argument, so `chime(0)` and `chime(1)` are different sounds and `toast("ok")` is not `toast("error")`.
- The UI lane plays at most 4 sounds in any second. The count-up tick takes at most half of that, so the flip and the click after it still sound.
- The motif is the signature, so it plays at most once every 8 seconds. Each form has its own clock (a day-7 streak is not lost to a check-in a few seconds before), and the short form also waits out the full one. No motif starts while another is sounding. So a quest claimed within 8 s of a check-in gets the coin and no second jingle.
- The 6-voice cap drops the lowest priority, oldest voice first, so a Moment outranks a Reward outranks UI.

### App-wide

`<SoundLane />` in `src/app/layout.tsx` calls `sfx.setApp(true)`, so reward and UI sounds work on every tab, not only in Play. The audio context is still made only inside a real tap, and nothing is fetched before one.

- After about 15 s of silence the context is suspended, and the next tap wakes it. Play is exempt while it is open (`setPlaying(true)`), and so is an open box or a first-box reveal on screen (`acquire()` and `release()`, held only for those short stretches), because their sounds come from timers and polls (a box appears, a box is in reach), not taps. No tab holds a lease for itself: Today, Crew, Chat and Me rely on `<SoundLane />` and sleep like any other screen.
- A sound that comes from a timer or a message while the context sleeps asks it to wake, and plays only if it is up within 400 ms. Nothing queues up and bursts out later. On iPhone Safari a sleeping context usually cannot wake without a tap, so the first such sound after a long silence can be missed.
- Nothing sounds while the page is hidden, and hiding it stops what is playing.
- Quiet hours, 23:00 to 07:00 Lagos time (the same window as push): the master drops to half, and the crowd "ehn" (`crowdEhn`, `outside`), the shekere and the horn are skipped. The full motif plays without its shekere shake.
- A low-tier phone (`deviceTier()` is "low") skips the shekere and the ehn.

### The sfx methods

The old voices keep their signatures (`tone`, `noise`, `shekere(ms, delay?)`, `bell`, `agogo(i)`, `stroke`, `talkingDrum(name)`, `danfoHorn`, `crowdEhn(small?)`, `knock`, `click`, `rip`, `swish(big?)`, `fly`, `chime(i)`, `coin`, `stamp`, `tick(k?)`, `flip`, `sparkle`, `fill`, `rise`). New cues, each with its picked file and a small synth fallback:

| Method | Cue file | Lane | Synth fallback |
|---|---|---|---|
| `motif("full" \| "short")` | `hoppaz_three_full`, `hoppaz_three_short` | Moment, Reward | bells D5 F#5 A5 short short long, a low drum on D3 with the last note; full adds a short shekere shake |
| `checkin()` | `checkin_stamp` | Reward | low thump, wood slap, one agogo note |
| `outside()` | `we_outside_ehn` | Reward | the small crowd "ehn" |
| `wave()` | `wave_received` | Reward | two soft rising pings |
| `alert()` | `box_alert` | UI | short, short, long pings |
| `toast("ok" \| "error")` | `toast_ok`, `toast_error` | UI | soft chime, low gentle knock |
| `tabTick(index)` | `tab_tick` | UI | a quiet wood tick, one pitch per tab: D6 F#6 A6 B6 E7 |
| `hotspot()` | `hotspot_enter` | Reward | two soft agogo notes, a low drum under |
| `vibe()` | `vibe_sticker_pop` | UI | one tiny pop |

`sfx.cue(name, hz?)` plays a cue's file and nothing else, for a caller that wants no synth. It keeps the lane and the rules of the method above (cue `we_outside_ehn` is still skipped in quiet hours).

### Where each moment is wired

| Moment | Sound | Buzz | Where |
|---|---|---|---|
| A tab changes (the lit tab is silent) | `tabTick(i)` | none | `src/components/BottomNav.tsx` |
| A toast, ok or error | `toast("ok" \| "error")`. Neutral and violet toasts, "copied" lines and the sign-up gate are silent | none | `say()` in `src/lib/store.ts` |
| Sound switched on (Today button, Me setting) | `agogo(3)` | none | `src/components/today/SoundToggle.tsx`, `src/components/me/SettingsGroup.tsx` |
| Buzz switched on (Me setting) | none | a 6 ms tap | `SettingsGroup.tsx` |
| A push arrives while the app is open | `alert()` | none | `src/components/app/PushAlert.tsx` |
| A wave arrives (the Chat poll, so only while Chat is open) | `wave()` | wave | `useInbox` in `src/lib/chat.ts` |
| Check-in lands | `checkin()`, then `motif("short")` 180 ms later | checkin | `landed()` in `src/lib/useCheckin.ts` |
| The +XP count-up on the check-in stub | two `tick`s | none | `XpCount` in `src/components/event/CheckInBlock.tsx` |
| Badges stamp on the check-in strip | `stamp()` per badge, 220 ms apart | one for the batch, on the second stamp (the first is inside the check-in's own buzz window) | `CheckInBlock.tsx` |
| Badges stamp on the Me shelf | `stamp()` per new badge, 220 ms apart | one for the batch, on the first stamp | `src/components/me/BadgeShelf.tsx` |
| The streak number stamps on Me | `stamp()`, then `motif("full")` 450 ms later on a multiple of 7 | streak | `src/components/me/NumberTiles.tsx` |
| WE OUTSIDE took (event card and Today deck) | `outside()` | outside | `weOutside()` in `src/lib/useGoing.ts` |
| A quest completes (not "sent for review", not a refusal) | `coin()`, then `motif("short")` 160 ms later | quest | `questDone()` in `src/components/EventQuestList.tsx` |
| The first box (welcome box, drops) | `click` on pick, `rip` on the tear, the Common drum as the first card comes out, `flip` per card, two count-up `tick`s on an XP card | pick, tear, snap | `src/components/reveal/Reveal.tsx` |
| Play: enter, leave, a box appears, a box comes in reach, a box too far to open | the "call" and "exit" drums, `rise`, `agogo(0)`, `knock` | none | `src/components/play/PlayLayer.tsx` |
| Play: a box opens | `shekere` build-up as the crate comes in, `rip` on the tear, `hush` then the tier's drum (or the legend phrase) with `swish`, `flip` per card, `chime`, `fly`, `fill`, `stamp`, `click`, `sparkle` on the card turning up, `crowdEhn` and `sparkle` on a level up, two XP chip `tick`s | crateShake, burstBig or stampSmall, levelUp, cardUp, refused | `src/components/play/open/engine.ts` |
| Sliding the Today deck | silent (Jae, 9 Oct) | a 6 ms tap | `src/components/today/tick.ts` |

Both count-ups (the first-box XP card and the Play XP chip) tick twice: partway, at step 6 of 10, and on the landing step. The UI lane lets the count-up tick through only twice a second, so more calls would sound as the two lowest notes and then silence.

Not called by any screen yet: `hotspot()`, `vibe()`, `danfoHorn()` (and the horn buzz), `cue()`. Planned in GAMIFY-NEXT 5.2 and not wired: the day-7 flourish inside Play, the short motif on a link-up accepted, and the soft count-up tick file (`count_up_tick` is not picked).

### Buzz

`src/lib/haptics.ts` is the one place the app buzzes: `haptics.buzz("checkin")` and the other names in its `PATTERNS`. Android Chrome can vibrate; iPhone Safari cannot, so there the sound and the picture carry every moment. The rules:

- Only after a touch, never while the page is hidden.
- At most one buzz every 400 ms. A second one inside the window is dropped, not queued and not merged, so whichever comes first wins.
- No pattern over 400 ms except the horn.
- The Buzz switch (`hz-buzz`) turns all of it off, separately from the Sound switch.

The 400 ms rule shapes the wiring. The box open's `rip` makes no buzz, because the burst follows within 120 ms and its pattern (the legendary `[60,30,90]`) would be dropped. A badge batch buzzes once, not once per stamp, because the stamps are 220 ms apart.

## Make the files again

The scripts are in `scripts/sfx/` (details in its `README.md`). The raw takes must live outside the repo.

```bash
export SFX_RAW_DIR=/some/folder/outside/the/repo/sfx-raw

node scripts/sfx/generate.mjs --dry   # the plan and the credit estimate, no calls
node scripts/sfx/generate.mjs         # makes what is missing, a rerun is free
node scripts/sfx/trim.mjs             # trims, normalises, measures, writes manifest.json
```

`ELEVENLABS_API_KEY` lives only in `.env.local`, which git ignores. The scripts read it inside the process. Never print it, paste it, pass it on a command line or write it to another file. `apply-picks.mjs` and the app never need it.

## Apply the picks

Listen in `public/sfx/try/`, then name a take per cue. A cue is a name from `manifest.json` (a hyphen works for an underscore), or a voice key from `picks.ts`:

```bash
node scripts/sfx/apply-picks.mjs "box_burst_common:2 coin:synth"
node scripts/sfx/apply-picks.mjs box_burst_common:2 talkingDrum:rare:1 --dry
```

`<cue>:<n>` takes take n (1 to 3). `<cue>:synth` puts the synth back and removes the shipped copy. A voice key has a colon of its own, so the take goes last: `talkingDrum:rare:1`. The script copies the file to `public/sfx/<cue>.<ext>` and rewrites that entry in `picks.ts`, trim included (see Levels). It checks every pick first, so a typo changes nothing, and picks you do not name stay as they are. It prints the flags the manifest found on a take, the trim, and the size now shipped. Then run `npx tsc --noEmit` and listen in the app with sound on.

## Levels

The files are peak-normalised to -1 dBFS and the synth is much quieter, so each pick has a trim `g` in `picks.ts`. The trim puts the file where the synth voice it replaces sits, inside its lane. The lane gain applies to both, so a change to `LANES` in `sfx.ts` moves a whole lane and needs no new trims.

How the trims were set (the 23 current picks):

1. Each synth voice was rendered with `renderOffline` through the real chain (lane gain, master 0.7, low-pass, compressor), four renders averaged because the synth is random. Stepped voices (`chime`, `tabTick`) and voices with variants (`swish` big and small) were averaged over their steps.
2. The picked file was rendered the same way, and `g` was solved until the two matched. The match is the mean of integrated loudness (BS.1770 LUFS, K-weighted, gated) and peak, both measured after the chain, because a short bright file and a sustained synth tone do not agree on either alone. Every pick landed within 0.5 dB of its synth, apart from the random voices (`fly`, about 1 dB).
3. `aim` is the loudness of the trimmed file in LUFS, from the take's LUFS in `manifest.json` plus the trim. `apply-picks.mjs` trims any other take of that cue to the same aim, so a take that is a few dB louder or softer still lands in the same place. Take 3 of `box_burst_common` is 4 dB hotter than take 2 and gets `g` 0.39 instead of 0.62. A synth row keeps an aim worked out from its synth voice, so a first pick of it is already near.
4. The cues that had no synth voice (the motif, check-in, outside, wave, alert, toast, tab tick, Hotspot, vibe) now have one, set against the neighbours in their lane: the full motif sits between the Play-enter drum and the epic burst, the short motif near the streak stamp, UI cues near the card click and the deck tick. `toast_error` take 1 was flagged near-silent because its raw take was quiet before normalising; the shipped file is full scale, and its trim (0.197) sits it on the synth error knock, which is the UI lane level.

A different take can still sit a few dB off by ear. If a pick is too loud or too soft, change its `g`.

The match is by that mean of loudness and peak. By a 400 ms loudness measure alone (how loud it sounds for a moment) some files read 0 to 6 dB hotter than their synth: the drums and the Hotspot and alert cues by about 6 dB, the full motif by 5, the short motif by 4. Only the very first sound after the first tap is ever the synth, so this shows only there.

### Listening notes: Play against before this pass

No file pick changed, but Play's own sounds moved, from the lanes and one pitch fix. If any of it is wrong by ear, the fix is `LANES` (a whole lane) or one row's `g` in `picks.ts`.

- Reward voices play at 0.6 and UI voices at 0.3 of the master, so the Play chime, fly and fill, the card click and the count-up tick are quieter than before. Measured against before: `reward_fly` about 12 dB, `card_land_click` about 14 dB, `chime` about 2.6 dB.
- The Play chimes are an octave higher than before: `reward_chime.mp3` is 440.4 Hz and its `base` was wrongly 880, so `chime(0..3)` sounded at 330, 440, 494 and 660 Hz. They now sound at E5, A5, B5 and E6 (659, 880, 988, 1318 Hz).
- In quiet hours (23:00 to 07:00 Lagos) the box build-up is silent, because the shekere is skipped, and the master is half.


### Stepped voices

`chime(i)`, `tick(k)` and `tabTick(index)` play the file at a `playbackRate` so each step lands on a note of D major pentatonic. `base` in `samples.ts` is the file's own pitch, measured with an FFT of the decoded file:

| File | Measured | Steps land on |
|---|---|---|
| `reward_chime.mp3` | 440.4 Hz (A4), nearly a pure tone. The old base was 880. | E5 A5 B5 E6, `chime(0..3)` |
| `tab_tick.wav` | 1190 Hz, a wood resonance close to D6 | D6 F#6 A6 B6 E7, `tabTick(0..4)` |
| `count_up_tick` | not picked, so `base` 987.77 is still a guess | measure it when it is picked |

Checked by rendering each step and reading its peak: the chime steps are within 1 cent of the notes, the tab ticks within 3.
