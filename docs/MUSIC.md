# Background music

Hoppaz gets background music the way games have it: a Play theme (a day version, and a night version after dark) and softer loops under the menus (Today, Me, Crew). The loops here are AI candidates for Jae to audition. A Lagos producer makes the final ones later (see "The producer step" at the end). Nothing in `src/` plays music yet: the build comes after Jae picks.

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

Per loop: Play and Stop, a progress line with the last 4 s tinted, Jump to the seam (starts 4 s before the wrap and tells you when it passed), Test with a box (the box burst and the Hoppaz three over the loop at the app's own sound levels), and Pick. In Play (day) there is a Dusk card: your picked day loop fades into your picked night loop over 3 s on the same beat. The footer has the music volume (default 35%, the level the app would use) and Copy my picks.

The picks line is `play_day:1 play_night:1 menu:1`: the slot, then the number on the card (1 to 3 here, in manifest order; `none` if nothing is picked). Jae sends that line back and the build uses those files. After `node scripts/music/build-mock.mjs`, any new track shows up as the next number in its slot.

## Terms

Eleven Music output may be used commercially, online and offline, on every self-serve plan, but not in film, TV, radio or a "Studio Game" (a monetised playable experience that is not an Indie Game, meaning under about 500,000 USD of lifetime game revenue and the developer under 1,000,000 USD of game revenue in its last financial year); only the Free plan must credit Eleven Music, releasing the music on streaming services needs Creator or above, and each track keeps the terms of the plan it was made under, so a small app like Hoppaz looks covered, but this key's plan tier cannot be read, so check it before shipping any of it.

- Source: elevenlabs.io/eleven-music-model-specific-terms, page dated 09 October 2026, read on 10 October 2026. The first planning note said Starter must credit; the current page says only Free does. The page is new and changes, so read it again before launch and have someone who signs contracts read it too.
- Hoppaz has a playable mode that makes money, so it relies on staying an Indie Game. If it passes either revenue limit the terms give 60 days to move to a plan that allows Studio Games or stop using the output in that game.
- A producer-made final (below) removes all of this.

## How the app should play the music

This is the agreed behaviour for the build that comes after Jae picks. The "build notes" are proposals that follow the existing sound code (`src/lib/sound/sfx.ts`, `src/lib/deviceTier.ts`, `src/lib/theme.ts`); tune levels by ear on a phone.

| Behaviour | Agreed | Build notes |
|---|---|---|
| Play theme | Play plays the Play theme, a day loop and a night loop. | Crossfade at dusk: 3 s, equal power (sine in, cosine out), the incoming loop joins at the same position in the bar so the beat does not move. This only works for a pair with the same BPM, so keep day and night at the same BPM, including the producer's. The page's `dusk()` in `scripts/music/mock/music.template.html` is the reference. Dusk follows the Lagos clock in `themeAt()` (`src/lib/theme.ts`: day 06:30 to 18:45), unless Play draws its night from the Hopper's theme choice, in which case follow what Play draws. If Play is not open at dusk, start the right loop when it opens. |
| Menus | The menu loop plays on Today, Me and Crew, at a lower level than Play. | One loop that keeps running as the Hopper moves between the three, never restarting. Start values: the music bus at 35% for Play (the audition page's app level); 25% for the menu loop, which is also mastered 3 dB lower, so about 6 dB under Play. Moving between Play and the menus is a 1.5 s equal power crossfade (the BPMs differ, so it is not beat matched). Other screens (event pages, chat, camera hunt, intro) stay silent until decided. |
| Settings | A separate Music switch in Settings, next to Sound. Default on, but quiet. | "Quiet" means the start levels in this table. A `MUSIC` row under `SOUND` in `SoundRows` (`src/components/me/SettingsGroup.tsx`), saved as `hz-music` ("on" or "off", default on) like `hz-sound`. Lines: on, "Soft music under Play and the menus. Quieter from 11pm to 7am."; off, "No music. Sounds stay." Proposed: the speaker button in Play and the button on Today (the `hz-sound` mute) silences music as well, because it is the app's one mute; the Music switch silences music only. |
| Ducking | Music ducks about 6 dB under sound effects and voice notes. | Gain 0.5 on the music bus while a Moment or Reward lane sound is sounding and while a voice note plays or records. Attack about 40 ms, release about 500 ms (about 800 ms after a voice note). UI lane ticks do not duck. |
| Page hidden or another app plays | Music fades out when the page is hidden or another app plays audio. | `visibilitychange` to hidden, and `pagehide`: fade out in 300 ms, stop the sources, suspend. An `interrupted` context (iPhone call, Siri, another app's audio) is treated the same. Do not resume by itself: music comes back on the Hopper's next real tap, with a 1.5 s fade in. Android has no interruption event, so the hidden rule is the guard. Music must hold a lease on the audio context so the 15 s idle suspend in `sfx.ts` does not cut it, and release it when music stops. |
| Never before a real tap | Music never starts before a real tap. | Use the context `sfx.ts` already makes inside a gesture (pointerdown, touchend, click, keydown). No second context. Nothing is fetched or decoded before that tap, and nothing autoplays on load, on a route change, from a timer or from a push. |
| Lazy and cached | Lazy-loaded on first need and cached. | Fetch and decode only the loop the screen needs, after the first tap: the day or night loop in Play, the menu loop on the menus. Keep the decoded buffer for the session. While in Play, fetch the other Play loop when idle so dusk is instant. Serve the files with a content hash in the name and `Cache-Control: public, max-age=31536000, immutable`, and add them to the service worker's runtime cache (not its precache). Sizes: 0.55 MB each Play loop, 0.67 MB the menu loop, 1.77 MB all three. |
| Quiet hours | 23:00 to 07:00 Lagos lowers it further. | The same window as push and the sound effects (`sfx.ts` halves its master). Start value: music another 6 dB down, so half the amplitude. |
| Low-tier phones | Low-tier phones get the menu loop only. | `deviceTier() === "low"` (2 GB or less memory, or data saver). Only the menu loop is fetched and decoded; no day or night loop, so no 1.1 MB of extra download and no extra decoded audio in memory (each decoded loop is about 13 to 16 MB). Read as: on a low tier Play also plays the menu loop at the menu level. If Jae wants Play silent on those phones instead, say so before the build. |
| Silent switch | Respects the iPhone silent switch. | Web Audio only, on the shared context. Never an `<audio>` element and never `navigator.audioSession.type = "playback"`: both ignore the switch. The audition page does the same on purpose. |

Where the code goes: a `music` module beside `sfx.ts` sharing its context, plus a small picks file in the style of `src/lib/sound/picks.ts` that maps each slot to its file, so changing a pick is a one line change. Loop each file with `loop = true` on an `AudioBufferSourceNode`. The audition page already handles a phone that leaves the MP3 delay in the decoded audio (it trims 1105 samples and says so on the card); copy that logic.

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

## Open issues

1. Not tried on an iPhone. Headless Chrome has no speakers and no Safari. Jae's first tap is the real gapless and silent switch test. If the card's loop check line says it trimmed padding or that the length is off, send that line back.
2. Nobody has listened to the loops in this review. The vocal and chant screen in `scripts/music/speech.mjs` is a heuristic; `force_instrumental` is on, and a listen is the real check.
3. The raw 48 kHz WAV takes are gone: the scratch folder holding them was cleared. The MP3 loops and manifest are intact, but loops cannot be re-cut from the raw audio, and new takes cost about 643 credits each. `generate.mjs` now refuses to pay twice for a track the ledger shows as paid.
4. Budget: 169 credits left under the 3000 ceiling. A second Play day candidate (643) needs someone with authority over the budget to run `node scripts/music/generate.mjs --wave 2 --max-credits 3600`. The 675 unexplained credits from before this work are not counted.
5. Terms: the plan tier cannot be read with this key, and the terms page is dated the day the loops were made (see "Terms").
6. `localdb/phone-https/tunnel.mjs` prints only the playmode and today mock addresses. The music page is at `/mocks/music` on the same tunnel address (and `/mocks/sounds` for the sounds page). That file is outside this work.
7. Three decisions for the build: whether Play is silent or plays the menu loop on low tier phones; whether the speaker mute also silences music; whether dusk follows the Lagos clock or the Hopper's theme choice.

## The producer step

The final music is made by a Lagos producer. The AI loops are the brief: they show the feel, tempo, key and level. Hand over this document, `public/music/try/manifest.json` (every prompt) and the three MP3s, plus Jae's picks.

Ask for, per slot:

- Loops of 8 or 16 bars at a fixed tempo, D major, no tempo drift, the Hoppaz three as the hook in Play, no vocals. Play day and Play night at the same tempo so they crossfade on the beat. Longer than 35 s, or layered so the repeat is not obvious (stems for drums, bass and top help the app thin the music under a voice note).
- Loop-ready: the tail rendered into the head so there is no click and no fade; delivered as 48 kHz 24-bit WAV, plus a 128 kbps MP3 made with the LAME gapless tag (`scripts/music/loop.mjs` shows the encode).
- Level: about -16 LUFS integrated for Play, -19 for the menus, true peak under -1.5 dBTP. The menu loop uncluttered in the midrange so a voice note stays clear.
- Rights: the producer assigns the music to Hoppaz in writing, which removes the plan and Studio Game limits above.

To swap them in, replace the files under the same names, update the manifest, run `node scripts/music/build-mock.mjs` to audition them on the same page, and delete `public/music/try/`.
