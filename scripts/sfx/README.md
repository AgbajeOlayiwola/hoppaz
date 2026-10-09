# Sound candidates

Candidate sounds for the sound review in `docs/GAMIFY-NEXT.md` section 5, made with the
ElevenLabs Sound Effects API. The trimmed files and a manifest land in `public/sfx/try/`,
for listening. The app never requests that folder: a take only plays once `apply-picks.mjs`
copies it to `public/sfx/` and names it in `src/lib/sound/picks.ts` (see `docs/SOUND-FILES.md`).

| File | What it does |
|---|---|
| `cues.json` | The cue sheet: 36 cues, 3 variants each, with prompt, length and lane |
| `credits.mjs` | Prints the credit position (needs a key that can read the subscription) |
| `generate.mjs` | Cue sheet to raw mp3 files, two requests at a time |
| `trim.mjs` | Raw mp3 to trimmed, peak-normalised, measured files, and `manifest.json` |
| `apply-picks.mjs` | Copies the picked takes to `public/sfx/` and rewrites `picks.ts`. No key, no network |

## The key

`ELEVENLABS_API_KEY` stays in `.env.local` (git-ignored). The scripts read it inside the
process and never print it, log it or take it on a command line. Do not paste it anywhere.

## Run

Raw files must live outside the repo. Both scripts refuse a raw folder under it.

```bash
export SFX_RAW_DIR=/some/folder/outside/the/repo/sfx-raw

node scripts/sfx/generate.mjs --dry   # the plan and the credit estimate, no calls
node scripts/sfx/generate.mjs         # generate what is missing, a rerun is free
node scripts/sfx/trim.mjs             # trim, normalise, measure, write the manifest
```

`generate.mjs` skips a file that already exists, keeps a ledger of credits in
`$SFX_RAW_DIR/_ledger.json`, and stops before the `--budget` (default 4000). It runs the
first request alone and aborts if that cost is over 1.5x the estimate.

To re-roll bad takes, write `{ "<cue>-<n>": { "prompt": "..." } }` to a file and run
`node scripts/sfx/generate.mjs --redo that.json`. The old take is kept as
`<cue>-<n>.first.mp3` in the raw folder, and a variant is re-rolled once. Then run
`trim.mjs` again. `--only a,b` limits either script to some cues.

## What trim.mjs does

Mono, head cut at -45 dB and tail at -50 dB (against a -1 dBFS peak), a 15 ms fade out,
peak at -1 dBFS. Caps: UI 0.35 s, reward 1.2 s, moment 2.5 s, except `box_alert`, a UI
sound whose three plucks need 0.9 s. Up to 0.4 s a file is a WAV (22050 Hz, 16 bit, no
encoder padding); longer is an MP3 (96 kbps mono, 44100 Hz).

## manifest.json

One entry per cue, `variants[].file` is relative to `public/sfx/try/`. `lufs` is BS.1770
K-weighted loudness over the whole clip, ungated, because gated loudness is not defined
under 0.4 s. `flags` lists what the automatic checks found: `near-silent`, `clipped`,
`late-start`, `too-short`, `sustained`, `speech?`. The checks read the signal, not the
sound, so `speech?` and any "sounds right" call still need a listen. A variant with
`redone` was re-rolled once and `redone.firstFlags` says why.
