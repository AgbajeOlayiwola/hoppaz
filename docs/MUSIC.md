# Background music

Hoppaz gets background music the way games have it: a Play theme (a day version, and a night version after dark) and softer loops under the menus (Today, Me, Crew). The loops here are AI candidates for Jae to audition. A Lagos producer makes the final ones later (see "The producer step" at the end). The player is built and the loops are wired in (see "What was built"); the loops stay AI candidates until the producer step.

Sounds are D major pentatonic on Lagos instruments (talking drum, agogo, shekere, highlife guitar, danfo horn), and the brand motif "the Hoppaz three" is D5, F#5, A5, short short long. The music sits in the same world: D major, and the motif as the hook where a prompt asks for one.

## What was made

Three loops, all 16 bars, 44.1 kHz stereo MP3 at 128 kbps, instrumental. Every number below was measured on the decoded MP3, and the review measured it again independently (see "Checks").

| Track | Slot | Loop | BPM | Key | LUFS | True peak | Seam | Size |
|---|---|---|---|---|---|---|---|---|
| `play_day_afrobeats_bounce` | Play, day | 34.29 s | 112 | D major | -16.1 | -1.6 dBTP | 1.00 | 550 KB |
| `play_night_afrobeats_dim` | Play, night | 34.29 s | 112 | D major | -16.0 | -4.8 dBTP | 0.995 | 550 KB |
| `menu_lofi_highlife` | Today, Me, Crew | 41.74 s | 92 | D major | -19.0 | -5.1 dBTP | 0.982 | 669 KB |

- Day and night are both 112 BPM in D major on purpose: the app can crossfade from one to the other on the beat. Day has a plucked guitar hook (D5 F#5 A5 every 4 bars), night a kalimba one (every 8 bars). The menu loop has no hook, so it stays under a voice note.
- Files: `public/music/try/<name>.mp3` and `public/music/try/manifest.json` (prompt, BPM, bars, length, loudness, seam evidence, flags for every track). The folder sits in `public/`, so it deploys. Before launch, decide whether `try/` stays; nothing requests it.
- Not made: `play_day_amapiano_log` (a second Play day candidate, 643 credits) because the ledger would pass the 3000 credit ceiling, and five more candidates that are defined in `scripts/music/tracks.json` but switched off.
- Loops are 34 to 42 s, shorter than the 60 to 80 s first asked for. The budget bought takes of about 51 s, and a loop needs lead-in beside the cut. Over a long Play session a 34 s loop will be heard to repeat. Fine for choosing a feel, not for shipping.
- Credits: the ledger (`scripts/music/ledger.json`) stands at 2831 of 3000, planner probes included. The account also showed 675 music credits spent in the hour before this work started; nobody knows who spent them and they are not in the ledger. The review spent 0 credits: it made no ElevenLabs call.

How to rerun, the settings used and the cost model are in `scripts/music/README.md`.

## Audition

`https://<tunnel>/mocks/music` (served by `localdb/phone-https/proxy.mjs`; on the Wi-Fi proxy it is `https://<Mac IP>:3443/mocks/music`). One self-contained page, 2.3 MB, with the three loops inside. It follows what the app will do, so take the iPhone off silent first.

Per loop: Play and Stop, a progress line with the last 4 s tinted, Jump to the seam (starts 4 s before the wrap and tells you when it passed), Test with a box (the box burst and the Hoppaz three over the loop at the app's own sound levels), and Pick. In Play (day) there is a Dusk card: your picked day loop fades into your picked night loop over 3 s on the same beat. The footer has the music volume (default 35%, which is louder than the app now plays: Play is 17% and the menu loop 12% after the loudness check in "Review fixes") and Copy my picks.

The picks line is `play_day:1 play_night:1 menu:1`: the slot, then the number on the card (1 to 3 here, in manifest order; `none` if nothing is picked). Jae sends that line back and the build uses those files. After `node scripts/music/build-mock.mjs`, any new track shows up as the next number in its slot.

## Terms

Eleven Music output may be used commercially, online and offline, on every self-serve plan, but not in film, TV, radio or a "Studio Game" (a monetised playable experience that is not an Indie Game, meaning under about 500,000 USD of lifetime game revenue and the developer under 1,000,000 USD of game revenue in its last financial year); only the Free plan must credit Eleven Music, releasing the music on streaming services needs Creator or above, and each track keeps the terms of the plan it was made under, so a small app like Hoppaz looks covered, but this key's plan tier cannot be read, so check it before shipping any of it.

- Source: elevenlabs.io/eleven-music-model-specific-terms, page dated 09 October 2026, read on 10 October 2026. The first planning note said Starter must credit; the current page says only Free does. The page is new and changes, so read it again before launch and have someone who signs contracts read it too.
- Hoppaz has a playable mode that makes money, so it relies on staying an Indie Game. If it passes either revenue limit the terms give 60 days to move to a plan that allows Studio Games or stop using the output in that game.
- A producer-made final (below) removes all of this.

## What was built

The player runs in the app. Built 10 October 2026, on the `ui-refresh` branch, not committed.

| Where | What |
|---|---|
| `public/music/play_day.mp3`, `play_night.mp3`, `menu.mp3` | The three loops: byte copies of `try/play_day_afrobeats_bounce.mp3`, `try/play_night_afrobeats_dim.mp3` and `try/menu_lofi_highlife.mp3`. Stable names, so a producer's files drop in under the same names. `try/` stays for listening and nothing requests it. |
| `src/lib/sound/musicPicks.ts` | One row per slot: the file, the loop's exact length in samples, its sample rate. |
| `src/lib/sound/music.ts` | The player. `music.want(slot)`, `music.setOn(bool)`, `music.isOn()`, `music.subscribe(fn)`. |
| `src/components/app/MusicHost.tsx` | Mounted in `src/app/layout.tsx` next to `<SoundLane />`. Picks the slot from the route, Play mode and the theme, and calls `music.want`. It makes no sound and no request itself. |
| `src/components/me/SettingsGroup.tsx` | The `MUSIC` row under `SOUND` in Me, Settings. |
| `src/lib/sound/sfx.ts` | Three small additions that change no sound: `sfx.context()` (the shared context, once a tap made it), `sfx.onVoice(fn)` (told of each voice that will sound: lane, start, end) and `sfx.quiet()`. One change to the hidden-page sleep: while a lease is held (the music is fading out), the context suspends 350 ms after the page is hidden, not at once, so the 0.3 s fade runs. `samples.ts` now exports its `decode` (both the promise and the callback form). |

How it works:

- **Which slot.** Play (the map at `/` with Play open) is `play_day` or `play_night`, by the theme the map is drawn in (`useTheme()`), so the Hopper's Dark, Light or Lagos clock choice decides, and the music matches the map's look. `/discover`, `/me` and `/crew` exactly are `menu`. Everything else is silent: the events map outside Play, Chat and the group and move rooms under `/crew`, event pages, the avatar maker, quests and drops. To give another path music, add it to `MENUS` in `MusicHost.tsx`.
- **When it can start.** Only after a real tap or key press (a script's `dispatchEvent` does not count), on the context `sfx.ts` made in that tap. Before it, nothing is fetched, decoded or made. Only the loop the screen needs is fetched, once; the decoded buffer is kept for the session. The other Play loop is fetched only for a Hopper on the Lagos clock within 20 minutes of dusk or dawn (checked 5 s into Play and every 30 s), so dusk is instant for the one Hopper who will hear it; for everyone else it is loaded on demand if the theme ever changes, and the 3 s crossfade covers the load. A failed fetch is logged once and tried again after a minute.
- **Chain.** loop, its fade gain, the bus (quiet hours), the duck, the destination. It does not go through the sound effects' master, low-pass or compressor, so the sound effects are untouched. Loops are `AudioBufferSourceNode` with `loop` on; a phone that leaves the MP3's 1105 sample delay in the decode gets it trimmed with `loopStart` and `loopEnd`, using the length in `musicPicks.ts`.
- **Moving between slots.** A 1.5 s equal power crossfade (sine in, cosine out). Play day to Play night (dusk, and back at dawn) is 3 s, and the incoming loop starts at the same place in the bar, so the beat does not move. The menu loop keeps running across Today, Me and Crew and is never restarted. Leaving for a silent screen fades out in 1.5 s and frees the nodes and the lease. Coming back to the loop while that fade-out is still running (Today, Chat, Me within a second or two) brings the same copy back up from where it is; it is not started again, so two copies never sound together.
- **Levels.** Play 0.17 on the bus, the menu loop 0.12 (mastered 3 dB lower, so about 6 dB under Play). Chosen by loudness against the sound effects (see "Review fixes"): K-weighted through the real chain, Play night is about -31 LUFS, Play day -31.5 and the menu -37.5; the first values, 0.35 and 0.25, sat at -25 and -31 and were louder than nearly every sound effect. Quiet hours (23:00 to 07:00 Lagos) take the bus to half, another 6 dB, and it follows the clock while playing.
- **Ducking.** 6 dB under every Moment and Reward sound, 3 dB under a UI sound (`DUCK_LANES`). Down in about 40 ms. A Moment or Reward dip is held 0.6 s after its sound ends and then comes back in about 0.7 s, so the sounds of one box open (gaps of 0.4 to 0.5 s) are one dip, not three. A UI dip is held 0.1 s, so a tab tick dips the music for about 0.6 s. A tick on top of a deeper dip does not make it shallower. The UI dip is a change from the agreed row below (see "Open issues", 8).
- **Hidden page.** `visibilitychange` to hidden, `pagehide`, or an `interrupted` context: fade out in 0.3 s and stop, and the "a real tap has happened" flag is cleared. `sfx.ts` suspends the context 350 ms after the page is hidden (not at once: a suspended context freezes its clock and the fade would never run). It comes back on the next real tap on a visible page, with a 1.5 s fade in, never by itself: a Back button, a route change, a redirect or the dusk flip after one of these stops starts nothing until that tap.
- **Context lease.** The player takes `sfx.acquire()` the moment a start begins, before the fetch, and keeps it while any loop is alive, so the 15 s idle sleep in `sfx.ts` cannot suspend the context under a slow load or a playing loop. It lets go when the last loop is gone, or when a start is given up (screen changed, page hidden, switch off, load failed). The player never calls `resume()` itself: if the context is asleep when the loop is ready it waits up to 1.5 s for the tap that is waking it (`sfx.unlock` asked), and otherwise gives up, and the next tap starts the loop from the kept buffer.
- **Low-tier phones.** `deviceTier() === "low"` gets the menu loop only, in Play too (Play plays the menu loop at the menu level). No Play loop is fetched or decoded.
- **Switches.** The Music switch is saved in `localStorage` as `hz-music` ("on" or "off", default on) and is separate from Sound. Sound off (the Me row, the speaker in Play, the button on Today) silences music as well, and bringing Sound back brings the music back on the same screen.

Decisions that were open, made as proposed (change them in one place each if Jae wants otherwise): Play is not silent on low-tier phones, it plays the menu loop; the one mute silences music; Play's day or night follows the theme the map is drawn in (`useTheme()`), not the raw Lagos clock. With the default Dark appearance Play is always night, so the day loop and dusk are heard only by a Hopper on Light or Lagos clock.

Not done:

- Content-hashed names, an immutable `Cache-Control` and a service worker runtime cache (the "Lazy and cached" row). The names are stable on purpose, `public/sw.js` has no fetch handler, and the files are served with the host's default headers, so a reload revalidates them.
- Ducking under voice notes: there are none in the app yet, and Chat is silent.
- Not tried on an iPhone or any real speaker (see "Open issues", 1).
- Swapping in the producer's loops needs the row in `musicPicks.ts` updated with each loop's length in samples (`loopSamples` in the manifest); the file names and the code stay.

## How the app should play the music

This is the agreed behaviour. The "build notes" are the proposals the player follows (`src/lib/sound/sfx.ts`, `src/lib/deviceTier.ts`, `src/lib/theme.ts`); where the build differs, "What was built" above says so. Tune levels by ear on a phone.

| Behaviour | Agreed | Build notes |
|---|---|---|
| Play theme | Play plays the Play theme, a day loop and a night loop. | Crossfade at dusk: 3 s, equal power (sine in, cosine out), the incoming loop joins at the same position in the bar so the beat does not move. This only works for a pair with the same BPM, so keep day and night at the same BPM, including the producer's. The page's `dusk()` in `scripts/music/mock/music.template.html` is the reference. Dusk follows the Lagos clock in `themeAt()` (`src/lib/theme.ts`: day 06:30 to 18:45), unless Play draws its night from the Hopper's theme choice, in which case follow what Play draws. If Play is not open at dusk, start the right loop when it opens. |
| Menus | The menu loop plays on Today, Me and Crew, at a lower level than Play. | One loop that keeps running as the Hopper moves between the three, never restarting. Start values: the music bus at 35% for Play (the audition page's app level); 25% for the menu loop, which is also mastered 3 dB lower, so about 6 dB under Play. As built after the loudness check: 17% and 12%. Moving between Play and the menus is a 1.5 s equal power crossfade (the BPMs differ, so it is not beat matched). Other screens (event pages, chat, camera hunt, intro) stay silent until decided. |
| Settings | A separate Music switch in Settings, next to Sound. Default on, but quiet. | "Quiet" means the start levels in this table. A `MUSIC` row under `SOUND` in `SoundRows` (`src/components/me/SettingsGroup.tsx`), saved as `hz-music` ("on" or "off", default on) like `hz-sound`. Lines as built: on, "You hear soft music in Play, Today, Crew and Me. Quieter from 11pm to 7am."; off, "No music. You still hear the sounds."; Sound off, "Music is on, but Sound is off, so you hear none." The speaker button in Play and the button on Today (the `hz-sound` mute) silences music as well, because it is the app's one mute; the Music switch silences music only. |
| Ducking | Music ducks about 6 dB under sound effects and voice notes. | Gain 0.5 on the music bus while a Moment or Reward lane sound is sounding and while a voice note plays or records. Attack about 40 ms, release about 500 ms (about 800 ms after a voice note). UI lane ticks do not duck. Built: Moment and Reward lanes, 6 dB; the UI lane 3 dB; 40 ms down, held 0.6 s (UI 0.1 s) and about 0.7 s back; the voice note part waits for voice notes to exist, and Chat is silent anyway. |
| Page hidden or another app plays | Music fades out when the page is hidden or another app plays audio. | `visibilitychange` to hidden, and `pagehide`: fade out in 300 ms, stop the sources, suspend (built: `sfx.ts` suspends 350 ms after hiding, so the fade runs first). An `interrupted` context (iPhone call, Siri, another app's audio) is treated the same. Do not resume by itself: music comes back on the Hopper's next real tap, with a 1.5 s fade in. Android has no interruption event, so the hidden rule is the guard. Music must hold a lease on the audio context so the 15 s idle suspend in `sfx.ts` does not cut it, and release it when music stops. |
| Never before a real tap | Music never starts before a real tap. | Use the context `sfx.ts` already makes inside a gesture (pointerdown, touchend, click, keydown). No second context. Nothing is fetched or decoded before that tap, and nothing autoplays on load, on a route change, from a timer or from a push. |
| Lazy and cached | Lazy-loaded on first need and cached. | Fetch and decode only the loop the screen needs, after the first tap: the day or night loop in Play, the menu loop on the menus. Keep the decoded buffer for the session. While in Play, fetch the other Play loop when idle so dusk is instant (built: only for a Hopper on the Lagos clock near dusk or dawn; the others never hear it). Serve the files with a content hash in the name and `Cache-Control: public, max-age=31536000, immutable`, and add them to the service worker's runtime cache (not its precache). Sizes: 0.55 MB each Play loop, 0.67 MB the menu loop, 1.77 MB all three. |
| Quiet hours | 23:00 to 07:00 Lagos lowers it further. | The same window as push and the sound effects (`sfx.ts` halves its master). Start value: music another 6 dB down, so half the amplitude. |
| Low-tier phones | Low-tier phones get the menu loop only. | `deviceTier() === "low"` (2 GB or less memory, or data saver). Only the menu loop is fetched and decoded; no day or night loop, so no 1.1 MB of extra download and no extra decoded audio in memory (each decoded loop is about 13 to 16 MB). Read as: on a low tier Play also plays the menu loop at the menu level. If Jae wants Play silent on those phones instead, say so before the build. |
| Silent switch | Respects the iPhone silent switch. | Web Audio only, on the shared context. Never an `<audio>` element and never `navigator.audioSession.type = "playback"`: both ignore the switch. The audition page does the same on purpose. |

Where the code is: `src/lib/sound/music.ts` beside `sfx.ts`, sharing its context, and `src/lib/sound/musicPicks.ts`, the small picks file that maps each slot to its file. Each loop is an `AudioBufferSourceNode` with `loop = true`; the trim for a phone that leaves the MP3 delay in the decode is the audition page's logic, in `fit()`.

## Checks

Done on 10 October 2026.

| Check | Result |
|---|---|
| Key safety | A Node script read the ElevenLabs key and searched every file in the repo (without `node_modules`, `.git`, `.next`), the `localdb` folder and the scratch folder for the whole value, its first and last 16 characters and its base64 form. Found outside `.env.local`: false. The scripts redact the key from anything they print. |
| Page loads | `/mocks/music` returns 200 and the same bytes as the file. Headless Chrome at 390x844: no console errors or warnings from the page; no horizontal overflow at 320, 360, 375, 390 and 430 px. No audio context exists before the first tap. |
| All loops decode | All three decode within about half a second of the first tap. Chrome ran at 48 kHz and resampled; each card reads "Loop check: exact". |
| No gap at the wrap | Three separate checks. An offline render of the decoded buffer through the page's loop settings equals the buffer exactly (max difference 0) across two wraps. A live capture of the page's own output across the wrap, from Jump to the seam, matches the decoded audio on both sides of the wrap with the same alignment (shift difference 0 samples for all three) and a residual under -140 dB against the signal. And the seam counter reached 1 on each. With the delay and padding faked back in (what a phone that ignores the MP3 tag would hand over) the trim path ran and gave the same result for day and menu; night slips one sample (21 microseconds) because a resampler can round the length either way. |
| Test with a box | The burst is scheduled 1.4 s after the loop starts, the motif 0.7 s after the burst, at gains 0.435 and 0.496 (the app's trims times the 0.7 master). |
| Day to night | Both fades start on the same sample, run 3 s with 128 point sine and cosine curves (equal power, mid point 0.703 and 0.711), and the night loop starts at the same fraction of the bar (difference under 0.000001). The button flips to Night to day, and back. The linear ramp fallback never ran. |
| Picks and copy | One pick per section; tapping it again clears it. Picks survive a reload (saved as `hz-music-picks`). Copy gives `play_day:none play_night:none menu:none` with nothing picked and `play_day:1 play_night:1 menu:1` with a pick in each. |
| Page hidden | Music stops when the page is hidden. |
| Loudness, true peak, length | Re-measured with ffmpeg on the decoded MP3s: -16.1, -16.0 and -19.0 LUFS and -1.6, -4.8 and -5.1 dBTP, the same as the manifest. Sample counts equal `loopSamples` (1,512,025, 1,512,016 and 1,840,712), and macOS CoreAudio reports the same valid frames. Tempo from the length: 111.998, 111.999 and 91.999 BPM. |
| Seam | Level step and spectral step at the join sit at or under the 90th percentile of the loop's other bar lines, with one exception: the night loop's level step is 0.08 dB over it. Each loop starts a few milliseconds before a kick or guitar attack, so a click detector fires on that attack; the sample step across the wrap is smaller than the loop's 99th percentile step in all three. |

To rerun: `node scripts/music/check/drive.mjs` (one headless Chrome, about 70 s; needs the phone proxy), `node scripts/music/check/measure.mjs` (seconds).

### The player in the app

Done on 10 October 2026 in one headless Chrome at 390x844 against the dev server, with Web Audio hooked to count source starts and read the gains. The driver was a scratch script and is not in the repo. Chrome ran with `--mute-audio`, so nothing was heard.

| Check | Result |
|---|---|
| Before the first tap | On `/discover` after load and 3 s idle: no request under `/music/`, no `AudioContext`, no source started. |
| `/discover` | After one tap the menu loop starts: one source with `loop` true, `loopStart` 0, `loopEnd` equal to the buffer length, gain 0.25 after the 1.5 s fade in. |
| `/crew` | Same source, no restart (still one start), no second fetch. |
| `/` (map) outside Play | The gain falls to 0 over about 1.4 s and the source ends. |
| Enter Play (tap the avatar) | The Play loop for the theme starts (`play_night.mp3` at night), gain 0.35. About 5 s later `play_day.mp3` is fetched, nothing else. |
| Dusk | Setting the Hopper's theme while in Play starts the other loop at the same place in the bar (0.000 ms apart), a 3 s crossfade whose two gains squared sum to 0.1221 to 0.1229 (the equal power target is 0.1225), then one loop. And back. |
| Ducking | Leaving Play plays the exit drum (Reward lane): the duck gain goes from 1 to 0.5 (6 dB), holds while the sound rings, and is back at 0.99 about 400 ms after it ends. |
| Hidden page | The sources stop. Visible again: nothing starts. The next tap starts the menu loop with a fade in. |
| Music switch | Off: the music stops, `hz-music` is "off", the row reads Off. A tap starts nothing. On: it returns. The row sits between SOUND and BUZZ. |
| Sound off | The music stops (Music row still On, its line says Sound is off); Sound on brings it back. |
| `/chat` | Nothing plays, a tap and a key press start nothing. |
| Low tier (`?tier=low`) | Play plays the menu loop at 0.25; only `menu.mp3` is requested. |
| Daytime, no tap | `/?play` (Play opened by a link, no tap): no request and no sound. After the first tap, with the clock moved to the afternoon and Lagos clock on, the day loop plays at 0.35 and the bus is 1 (it read 0.5 at 03:xx Lagos, quiet hours). |
| Files | Only `menu.mp3`, `play_day.mp3` and `play_night.mp3` were requested. Nothing under `try/`. No console errors or warnings from the app. |

The Music switch was checked on a temporary dev page that hosted the same Settings rows, because Me is behind the sign-up wall for an anonymous browser. The page was deleted afterwards.

The table above is the first build. Its levels (Play 0.35, menu 0.25), the 5 s prefetch of the other Play loop and the 450 ms duck release were changed by the review fixes below.

### Review fixes

Two reviews (an iPhone correctness read and a feel, data and battery read) made eight findings between them, one of them found by both. Fixed 10 October 2026 in `music.ts`, with a few lines of sleep logic in `sfx.ts`. Re-checked in one headless Chrome at 390x844 against the dev server (Web Audio hooked to count starts and read gains, `--mute-audio`, so nothing was heard), one scenario per finding, and `tsc --noEmit` and ESLint on the changed files (exit 0).

| Finding | Fix | Re-check |
|---|---|---|
| The lease was taken after the load, so a slow load let the idle sleep suspend the context, and the loop then called `resume()` with no tap. | The lease is taken at the top of `start()`, before the fetch, and given back when a start is abandoned (screen changed, page hidden, load failed) or `halt()` finds nothing playing. After the load the player never calls `resume()`; it waits up to 1.5 s for the tap that is waking the context, else gives up and the next tap starts the loop from the kept buffer. | `menu.mp3` held 18 s on `/discover`: the context stayed running the whole time, `suspend()` was never called, the loop started at 18.03 s with the context running, and `resume()` was never called by the player (before: suspended at 15.2 s, `resume()` with no activation). Leaving `/discover` during a slow load: nothing started and the context slept 15 s after the tap (the lease came back). A context asleep at the tap (suspended on purpose after hidden and visible): the tap's own `unlock()` woke it and the loop started 30 ms later, running. |
| `tapped` was never cleared, so a Back button, a route change or the dusk flip restarted the music with no tap. | `tapped` is cleared on hidden, `pagehide` and an interrupted context; only `onGesture` sets it. | Menu loop, then Chat, hidden and visible, 6.5 s, `history.back()` to `/discover`: no start (before: `menu.mp3` at 0.25). Three scripted (untrusted) route changes after it: no start. `pagehide` then an untrusted route change: no start. A real tap: starts from the kept buffer, no new request. |
| The music was louder than nearly every sound effect (Play -25 LUFS, menu -31). | `LEVEL` 0.17 for Play and 0.12 for the menu. | Re-measured with the same ffmpeg K-weighting: Play night -31.4, Play day -31.5, menu -37.5 LUFS (the 6.1 dB gap between them is kept). Of 34 effects, 6 of 9 Moment sounds and 3 of 14 Reward sounds are above Play music (before: 5 in all). The other Reward sounds are 1 to 16 LU under it and duck it a further 6 dB while they sound; the UI sounds are 7 to 25 LU under it. |
| The quiet UI sounds were masked by the loops. | A 3 dB duck on the UI lane (held 0.1 s), on top of the lower level. | Band power of each sound's dominant 1/3-octave bands against the loop's mean band power: click -15.6 to -6.3 dB against Play night, flip -8.1 to +1.2, toast error -6.3 to +2.9, count tick +0.8 to +10.1, knock -2.7 to +6.6, Crew tab tick -1.5 to +7.8. Click is still under Play day (-8.1) and night (-6.3): it is a very quiet tick (-54 LUFS) and was left. A tab tick on the real chain dips the music to 0.71 for about 0.6 s and it is back at 1.0. |
| The duck pumped during a box open. | A hold after each sound (0.6 s Moment and Reward, 0.1 s UI), a 0.7 s release, and the deeper dip wins when sounds overlap. | A real common box open in `/dev/open` with the music playing (the clock moved to daytime so the shekere and crowd play): one dip to 0.5 from 40 ms to 4.6 s, then 1.0 (before: three 6 dB dips and two near full recoveries in 4 s). The rare box with a card: one dip to 0.5. |
| A default Hopper downloaded and decoded a Play loop they never hear. | `warm()` fetches the other Play loop only when the Hopper is on the Lagos clock and within 20 minutes of 06:30 or 18:45, at 5 s into Play and every 30 s. | Default Hopper in Play: only `play_night.mp3` requested, 8 s in (before: `play_day.mp3` at 5.1 s, 537 KB and 12.6 MB decoded). Light: only `play_day.mp3`. Lagos clock at 13:00: only `play_day.mp3`. Lagos clock at 18:35: `play_night.mp3` is fetched as well. |
| The 0.3 s fade on a hidden page never ran. | `sfx.ts` suspends the context 350 ms after hiding when a lease is held, and checks the page is still hidden then. | Hidden: the loop's gain fell from 0.1199 to 0 over 0.31 s with the context clock advancing, and `suspend()` came 352 ms after the hide (before: the clock froze at once with the gain at 0.25). |
| Today, Chat, Me inside the fade started a second copy at the top. | `begin()` brings a loop of the same slot that is still fading out (gain above 0.02) back up from where it is, and cancels its stop and its drop timer. | Today, Chat for 350 ms, Me: one start, one source, gain dipped to 0.107 and came back to 0.12 (before: a second source at offset 0, two copies sounding). A 3.5 s stay on Chat starts a new copy, as before. |

Re-run because `begin()` and the lease changed:

| Check | Result |
|---|---|
| Rapid route flips (11 changes in about 5 s, React strict mode on) | At most 1 source alive (before: 4); power never above one loop at full level (0.0144); largest gain step 0.0027 per 20 ms; every source and gain node freed except the one playing; one `AudioContext`; no console warnings. |
| Interrupted context | The loop fades out within 1.5 s; nothing restarts in the 5 s after the context comes back; the next real tap starts it. |
| Idle sleep | No music on `/chat`: suspended 15 s after the last tap. Music on `/discover`: running for the whole 22 s watched. After leaving: suspended about 17 s later. |
| Final pass on the shipped code | `/discover` before a tap: no request, no `AudioContext`. After a tap: `menu.mp3` at 0.12. `/crew`: same source, no restart. `/chat`: silent, and a tap there starts nothing. `/` (map, Play closed): silent. `/?play` before a tap: no request; after one, `play_night.mp3` at 0.17. `hz-music` off at boot: no request, no start. No console errors or warnings from the app. |

Not re-run: the Music switch itself live (it was checked with the first build, and with a temporary hook that called `music.setOn` on the new code: off stops the loop, a tap starts nothing, on brings it back), and the Sound mute button (the Today button was not on screen for an anonymous browser).

## Open issues

1. Not tried on an iPhone. Headless Chrome has no speakers and no Safari. Jae's first tap is the real gapless and silent switch test. If the card's loop check line says it trimmed padding or that the length is off, send that line back.
2. Nobody has listened to the loops in this review. The vocal and chant screen in `scripts/music/speech.mjs` is a heuristic; `force_instrumental` is on, and a listen is the real check.
3. The raw 48 kHz WAV takes are gone: the scratch folder holding them was cleared. The MP3 loops and manifest are intact, but loops cannot be re-cut from the raw audio, and new takes cost about 643 credits each. `generate.mjs` now refuses to pay twice for a track the ledger shows as paid.
4. Budget: 169 credits left under the 3000 ceiling. A second Play day candidate (643) needs someone with authority over the budget to run `node scripts/music/generate.mjs --wave 2 --max-credits 3600`. The 675 unexplained credits from before this work are not counted.
5. Terms: the plan tier cannot be read with this key, and the terms page is dated the day the loops were made (see "Terms").
6. `localdb/phone-https/tunnel.mjs` prints only the playmode and today mock addresses. The music page is at `/mocks/music` on the same tunnel address (and `/mocks/sounds` for the sounds page). That file is outside this work.
7. Three decisions for the build, made as proposed (see "What was built"): on low tier phones Play plays the menu loop; the speaker mute also silences music; dusk follows the theme the map is drawn in. Jae can overrule any of them.
8. The UI lane now ducks the music 3 dB (the agreed table said UI ticks do not duck). It was added so the quiet ticks are not masked after the level was lowered. To go back, take `ui` out of `DUCK_LANES` in `music.ts`.
9. Click is still under the music in Play (about 6 dB below night, 8 dB below day, by the 1/3-octave measure), and flip and the day Crew tab tick are near it. The duck attack is 40 ms, so a 2 ms click gets less than the full 3 dB. Raising their trims in `picks.ts` would fix it, but that changes the sounds with and without music (and the file is written by `scripts/sfx/apply-picks.mjs`), so it is a call by ear on a phone.
10. The loops are still louder in the audition page than in the app: its volume starts at 35% (`APP_VOL` in `scripts/music/mock/music.template.html`), the app plays Play at 17% and the menu at 12%. Change `APP_VOL` and run `node scripts/music/build-mock.mjs` if the page should match.
11. Still only checkable on an iPhone: gapless looping through `fit()`; whether Safari's `AudioParam.value` follows a fade in progress (the fades, the dip and the bring-back read it); and whether iOS accepts a `resume()` with no tap after the idle sleep (the player no longer depends on it: it waits for a tap).

## The producer step

The final music is made by a Lagos producer. The AI loops are the brief: they show the feel, tempo, key and level. Hand over this document, `public/music/try/manifest.json` (every prompt) and the three MP3s, plus Jae's picks.

Ask for, per slot:

- Loops of 8 or 16 bars at a fixed tempo, D major, no tempo drift, the Hoppaz three as the hook in Play, no vocals. Play day and Play night at the same tempo so they crossfade on the beat. Longer than 35 s, or layered so the repeat is not obvious (stems for drums, bass and top help the app thin the music under a voice note).
- Loop-ready: the tail rendered into the head so there is no click and no fade; delivered as 48 kHz 24-bit WAV, plus a 128 kbps MP3 made with the LAME gapless tag (`scripts/music/loop.mjs` shows the encode).
- Level: about -16 LUFS integrated for Play, -19 for the menus, true peak under -1.5 dBTP. The menu loop uncluttered in the midrange so a voice note stays clear.
- Rights: the producer assigns the music to Hoppaz in writing, which removes the plan and Studio Game limits above.

To swap them in, replace the three files in `public/music/` under the same names, update `public/music/try/manifest.json` and run `node scripts/music/build-mock.mjs` to audition them on the same page, then update the three rows in `src/lib/sound/musicPicks.ts` with each new loop's length in samples (no other code changes), and delete `public/music/try/`. Day and night must keep the same tempo and start on a bar line, or the dusk crossfade will not land on the beat.
