# Hoppaz background music: how to rerun

AI candidates for Jae to audition (ElevenLabs Music), made into seamless loops. A Lagos producer makes the finals later, so nothing here is meant to ship as is.

Slots: `play_day`, `play_night`, `menu` (Today, Me, Crew). All instrumental, D major pentatonic world, the Hoppaz three (D5 F#5 A5, short short long) as the hook where the prompt asks for one.

## Where things stand

| Track | Slot | Loop | BPM (planned / found) | LUFS | True peak | Seam | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `play_day_afrobeats_bounce` | play_day | 16 bars, 34.29 s | 112 / 111.998 | -16.1 | -1.60 dBTP | 1.00 | 536 ms blend |
| `play_night_afrobeats_dim` | play_night | 16 bars, 34.29 s | 112 / 111.992 | -16.0 | -4.80 dBTP | 0.995 | 8 ms declick join, starts at the section change at bar 8 |
| `menu_lofi_highlife` | menu | 16 bars, 41.74 s | 92 / 91.999 | -19.0 | -5.10 dBTP | 0.982 | second take (take 1 opened with 8 near-silent bars) |

The raw 48 kHz WAV takes (`music-raw`, outside the repo) are gone: the scratch folder that held them was cleared before the review on 2026-10-10. The MP3 loops and `manifest.json` in `public/music/try` are intact and are the only copies. `loop.mjs` cannot rebuild a loop until raw takes are put back (it says so and changes nothing), and `generate.mjs` now refuses to pay again for a track the ledger already shows as paid unless you pass `--regen <id>` or `--pay-again`.

Not generated: `play_day_amapiano_log` (wave 2, 643 credits) because the 3000 credit ceiling would have been passed after the menu regeneration, and the five wave 3 tracks (switched off in `tracks.json`). The loops are 34 to 42 s, not the 60 to 80 s the brief asked for, because the takes are 51 to 52 s (the budget does not stretch to longer ones) and a loop needs lead-in or tail beside it.

## Files

| File | What it is |
| --- | --- |
| `tracks.json` | The plan: 9 tracks, 3 per slot, with prompts, BPM, key, bars, wave and an `enabled` flag. |
| `generate.mjs` | Calls ElevenLabs Music, one track at a time, writes raw takes outside the repo. |
| `loop.mjs` | Analyses each raw take, cuts a seamless loop, normalises, encodes the MP3, writes the manifest. |
| `analyze.mjs`, `seam.mjs`, `speech.mjs`, `dsp.mjs`, `lib.mjs` | The pieces `loop.mjs` and `generate.mjs` use. No npm dependencies. |
| `calibrate-speech.mjs` | Checks the vocal and chant screen by mixing macOS `say` speech into the loops. Free. |
| `formats.mjs` | Which output formats this key accepts. `--real F` makes one 3 s generation (about 38 credits). |
| `probe.mjs` | Planner's access and cost probe. `--usage` is a read-only credit readout. |
| `ledger.json` | Credits this job has spent, probe included, and which prompt and take made each file. |
| `build-mock.mjs`, `mock/music.template.html` | Builds the phone audition page `localdb/phone-https/mocks/music.html` (served at `/mocks/music`) from the manifest and the MP3s. Rerun after new tracks land. |
| `check/drive.mjs`, `check/hook.js` | One headless Chrome at 390x844 that checks the audition page: decode, gapless wrap on the live output, box test, crossfade, picks, copy line, reload, page hidden. `short` and `pad` modes. |
| `check/measure.mjs` | Independent re-measure of the loops in `public/music/try` (loudness, true peak, length, tempo, the join) against the manifest. Takes seconds. |

Outputs:

- Raw takes (not present any more, see above): `<scratchpad>/music-raw/<name>.wav`, lossless 48 kHz 16-bit stereo (`pcm_48000`, the best format this key is allowed; proven with a real 3 s call). Outside the repo. Override with `MUSIC_RAW_DIR` or `--raw`. An earlier take is kept as `<name>.take1.wav`.
- Loops: `public/music/try/<name>.mp3` and `public/music/try/manifest.json`.

## Rerun

Needs Node 20 or newer and ffmpeg and ffprobe on the PATH (Homebrew: `/opt/homebrew/bin`). The ElevenLabs key is the line `ELEVENLABS_API_KEY=...` in `.env.local`. The scripts read it inside Node and never print it.

```sh
# 1. see what would run and what it costs (free)
node scripts/music/generate.mjs --wave 2 --dry-run

# 2. generate (skips any track whose raw file already exists, so reruns never pay twice)
node scripts/music/generate.mjs --wave 1          # one candidate per slot
node scripts/music/generate.mjs --wave 2          # adds the second play_day candidate
node scripts/music/generate.mjs --only menu_lofi_highlife

# 3. make the loops and the manifest (free, a few seconds per track)
node scripts/music/loop.mjs
node scripts/music/loop.mjs --only play_day_afrobeats_bounce
node scripts/music/loop.mjs --analyze             # tempo, grid and loop candidates only, writes nothing

# 4. regenerate one track that came out wrong (the old take is kept as <name>.take1.wav)
node scripts/music/generate.mjs --regen play_night_afrobeats_dim
node scripts/music/generate.mjs --regen play_night_afrobeats_dim --suffix "Absolutely no voices of any kind."
node scripts/music/loop.mjs --only play_night_afrobeats_dim
```

The ledger stands at 2831 of 3000, so wave 2 (643) does not fit. Raising the ceiling is a decision for whoever owns the budget: `generate.mjs --wave 2 --max-credits 3600`. To audition the other five tracks, set `"enabled": true` on them in `tracks.json`.

## Cost and the budget guard

- 12.5 credits per second of audio, 750 per minute, the same on `music_v2_5` and `music_v2`, the same for PCM and MP3 output. A 24 bar play track is about 51.4 s, so 643 credits; a 20 bar menu track is about 52.2 s, so 653.
- `/v1/music` sends no cost header (only `song-id`; checked), so `generate.mjs` reads the charge from the usage endpoint (music credits before and after) and falls back to the 12.5 per second estimate. Each charge was within 1 credit of the estimate. The result is in `ledger.json` with how it was measured.
- Before every call the script checks ledger total plus the estimate against the ceiling (3000, probe included) and stops if it would pass. A usage reading far above the estimate stops the run so someone can look.
- The key cannot read the plan tier or balance (`user_read` is missing), so the ledger is the only running total.
- The ledger does not count 675 music credits the account showed in the hour before the planner started (20:00 to 21:00 WAT, `music_v2_5`); nothing says who spent them. The account-wide 24 h music readout is therefore 675 higher than the ledger: 3504 against 2831 at the time of writing.

## What `loop.mjs` does to each take

1. Decodes to 44.1 kHz stereo float. Finds the tempo with a comb-filter search around the planned BPM, then a robust line fit through the strongest onset near every beat. Reports found BPM, drift between the two halves and beat wobble. (The three takes held their tempo to better than 0.01 percent, with 2 to 6 ms wobble.)
2. Snaps the beat grid to the real transients (sample accurate) and picks the downbeat from kick strength and chord change.
3. Rejects intro bars (quieter or sparser than the track), fades and dropouts. If no clean stretch of 16 bars exists it tries 12 then 8 and flags the track. Scores every legal downbeat start by how alike the two pieces of audio that get joined are: attack pattern, chroma, band spectrum. 4 bar phrase starts get a small bonus. The loop starts about 3 ms before a downbeat transient so the first play starts clean.
4. Cuts a whole number of bars (16 by default, `--bars`), then makes the join. In `pre` mode the last beat of the loop is blended with the audio just before the start; in `post` mode the audio that follows the cut is blended over the first beat. Either way the last sample of the loop is followed by what the take itself plays next, so there is no jump and no click. Blend lengths from one beat down to 8 ms are tried, the best seam measures win, and a short blend is chosen where the two sides do not match (a section edge, or a take whose tail is a fade). This is the "blend the material after the cut back into the head" idea, rotated one beat so the file starts on the downbeat when the take allows it.
5. One gain for the whole loop to -16 LUFS integrated (menu -19), a look-ahead limiter run on three tiled copies so it wraps, true peak under -1.5 dBTP (the loop aims for -1.55 or lower), 44.1 kHz stereo MP3 128 kbps CBR (libmp3lame, with the Xing/LAME gapless tag). The MP3 is decoded again and every number in the manifest is measured on that decoded file.

## Manifest fields

`name, slot, prompt, bpm, bars, seconds, lufs, bytes, seamScore, flagged` as asked, plus:

- `bpm` is the loop's effective tempo (bars x 4 beats over the exact length). `bpmPlanned` and `bpmFound` sit beside it. `prompt` is the prompt that made the take on disk, including the regeneration wording where one was used; `take` says which take that is.
- `flags` lists the reasons a track is flagged. `regenerate: true` means a flag that a new take could fix (wrong tempo, drift, fade or dropout in the loop, vocals, bad seam, no clean 16 bars); loudness notes do not set it. `notes` holds facts that are not problems, such as a take that ends with a fade the loop does not use.
- `seam` holds the evidence. Level step, spectrum step and a high-frequency burst test at the loop point against every other bar line or position (ratios at or below 1 mean the loop point is no more visible than elsewhere), the level of the blended beat against its neighbours, and how far apart the transients are across the cut (`alignment.residualMs`). `seamScore` is 1 at a worst ratio of 1 or less and 0 at 2.5. `naiveHardCutScore` is what a plain cut at the same place would have scored.
- `blendMode`, `blendMs`, `loopStartSec`, `loopStartBar` say how and where the loop was cut. `loopSamples`, `sampleRate` and `seconds` give the exact loop length.
- `speech` holds the vocal and chant screen values (see below).

## Playing the loops

Use Web Audio (`AudioBufferSourceNode` with `loop = true`) rather than an `<audio loop>` tag; the media element leaves a gap at the wrap in most browsers. Web Audio is also what follows the iPhone silent switch; an `<audio>` element or `navigator.audioSession.type = "playback"` ignores it. ffmpeg decodes each file to exactly `loopSamples` frames (`gapless: true`), which shows the delay and padding fields in the LAME tag are right. Checked in headless Chrome (48 kHz context, so the loops are resampled): the decoded length equals the loop length, an offline render and a live capture across the wrap both match the decoded audio to within rounding, so the wrap is gapless. macOS CoreAudio (`afinfo`, the Safari decoder family) reports the same valid frame counts. Safari on an iPhone has not been tried. If a browser leaves a gap of about 25 ms at the wrap, the file carries the standard 1105 sample encoder delay, so set `loopStart = 1105 / 44100` and `loopEnd = loopStart + seconds`. Fade each loop in over a few hundred ms when it starts, and crossfade between loops on the beat: `play_day_*` and `play_night_afrobeats_dim` are all 112 BPM in D major.

MP3 coding noise is present at the file edges as it is everywhere else. The high-frequency burst test above is measured on the decoded loop, and the junction sits inside the loop's normal range for all three files.

## Vocal and chant screen

Not a model, a screen. Two measures on the 300 to 3400 Hz band, in `speech.mjs`, run on the finished loop played twice:

- `repeat`: median bar-to-bar similarity of the voice-band spectrum, 2 or 4 bars apart. The three loops read 0.89 to 0.91. macOS `say` speech mixed 12 dB under the music reads 0.52 to 0.83, and a beat-locked random-word chant 12 dB under reads 0.49 to 0.74. Floor 0.82.
- `offGrid`: share of the 2 to 8 Hz level-modulation energy that is not locked to the bar rate. It supports `repeat`: it only counts (limit 0.18) when the bars also repeat less than a very tight loop (under 0.88), because slow 2 and 4 bar patterns put energy between the bar-rate lines.

Blind spot: one identical word repeated on every beat repeats like a drum loop and passes both measures. `force_instrumental` is on for every request, and the real check is listening. Rerun the calibration with `node scripts/music/calibrate-speech.mjs`.

## Terms (short)

Eleven Music output may be used commercially, online and offline, on every self-serve plan, but not in film, TV, radio or a "Studio Game" (a playable experience that is made available to the public and monetised, unless it is an Indie Game: under about 500,000 USD of lifetime game revenue and the developer under 1,000,000 USD of game revenue in its last financial year). Only the Free plan must credit Eleven Music; releasing the music on streaming services needs Creator or above; and a track keeps the terms of the plan it was made under if the plan is later downgraded. A small app like Hoppaz looks covered as an Indie Game, but this key's plan cannot be read, so check the plan before shipping any of it. Source: elevenlabs.io/eleven-music-model-specific-terms (page dated 09 October 2026). An earlier version of this README said Starter must credit; the current page says it does not. The page changes, so read it again before launch.
