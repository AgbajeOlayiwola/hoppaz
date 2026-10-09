# Sound files

The Play sounds are the Web Audio synth in `src/lib/sound/sfx.ts`. A voice can be swapped for a recorded file made with the ElevenLabs Sound Effects API. The synth stays as the fallback, so with no file picked the app sounds exactly as it did before. Sound review and the moments: [GAMIFY-NEXT.md](GAMIFY-NEXT.md) section 5.

## What the files are

| Where | What | Size |
|---|---|---|
| `public/sfx/try/` | 36 cues, 3 takes each (108 files, WAV up to 0.4 s, MP3 above) and `manifest.json`. For listening. The app never requests them. | 1.3 MB |
| `public/sfx/` | The picked takes, one per picked cue, named `<cue>.mp3` or `<cue>.wav`. Empty until a pick is applied. | 3 to 22 KB each, about 0.4 MB if all 36 are picked |
| `src/lib/sound/picks.ts` | Which file each voice plays, or `"synth"`. Every entry is `"synth"` today. | |
| `src/lib/sound/samples.ts` | Loads the picked files. Holds each sound's priority and level. | |

`try/` sits in `public/`, so it deploys. Before launch, decide whether it stays (1.3 MB of static files nothing requests).

## How the app plays them

- Every `sfx.x()` call looks up its key in `picks.ts` (`talkingDrum:common`, `agogo:0`, `coin`). If a file is picked and decoded, it plays as a voice like any other: same master gain, low-pass and compressor, the same 6-voice cap, the priority of the synth voice it replaces, and the same mute (`hz-sound`) and Play rules. Hidden page: samples stay silent. Callers do not change.
- If nothing is picked, the file is not decoded yet, or it failed, the synth voice plays exactly as before.
- Nothing is fetched on page load. The first real tap or key press while the audio engine is on starts the load: four files at a time, decoded with the same `AudioContext` the engine made (a script's `click()` does not count). Muted, nothing loads. A sound that fires before its file is ready plays the synth, so the very first sound after that tap, such as the Play entry drum, can still be the synth; every one after it is the file.
- A file that fails (404, network, cannot decode) is logged once as `sfx sample <file> ...`, never thrown, and that sound stays on the synth for the visit.
- A cue with no synth voice yet (`hoppaz_three_short`, `tab_tick`, `box_alert`, the toasts) plays through `sfx.cue(name)`, which plays the picked file or nothing. `sfx.cue("tab_tick", hz)` steps the pitch the way `chime(i)` and `tick(k)` do.
- Only these are called in the app today: the Play drums, `rise`, `agogo(0)`, `knock`, `rip`, `swish`, `shekere`, `chime`, `fly`, `fill`, `crowdEhn`, `sparkle`, `stamp`, `click`, `flip`, `tick` and the Today deck `agogo(3)`. Picking `coin`, `danfoHorn` or a cue-only sound changes nothing until a screen calls it.
- `renderOffline` always renders the synth.

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

`<cue>:<n>` takes take n (1 to 3). `<cue>:synth` puts the synth back and removes the shipped copy. A voice key has a colon of its own, so the take goes last: `talkingDrum:rare:1`. The script copies the file to `public/sfx/<cue>.<ext>` and rewrites that entry in `picks.ts`. It checks every pick first, so a typo changes nothing, and picks you do not name stay as they are. It prints the flags the manifest found on a take and the size now shipped. Then run `npx tsc --noEmit` and listen in the app with sound on.

## Levels

The files are peak-normalised to -1 dBFS and the synth is much quieter, so `META` in `samples.ts` sets a level (`g`) for each sound, matched to the synth voice it replaces and tuned with all three takes. A different take can sit a few dB off. If a pick is too loud or too soft, change its `g`.
