/**
 * Which loop plays in each music slot: a file in public/music/ (see docs/MUSIC.md).
 *
 * The names are stable on purpose. A Lagos producer's final loops replace the AI ones by
 * dropping into public/music/ under the same names. The one thing to touch then is the row
 * here: `samples` is the loop's exact length in samples at `rate` (the encoder's loop length,
 * `loopSamples` in public/music/try/manifest.json). music.ts compares it with what the phone
 * decoded, and trims the MP3 delay off on a phone that leaves it in. Without it a gapless
 * loop can click on an old iPhone. `samples: 0` trusts the decode as it is.
 *
 * Play day and Play night must keep the same tempo and start on a bar line: the dusk crossfade
 * joins the night loop at the same place in the bar. The menu loop can be any tempo.
 *
 * Level and duck are not here. They are the same for every loop and live in music.ts.
 */
export const MUSIC = {
  /** Play, from 06:30 to 18:45 Lagos (or whenever the app draws day). 112 BPM, D major, 16 bars. */
  play_day: { file: "play_day.mp3", samples: 1512025, rate: 44100 },
  /** Play after dark. Same 112 BPM, so day and night crossfade on the beat. */
  play_night: { file: "play_night.mp3", samples: 1512016, rate: 44100 },
  /** Today, Me and Crew, and Play on a low-tier phone. 92 BPM, D major, 16 bars, mastered 3 dB lower. */
  menu: { file: "menu.mp3", samples: 1840712, rate: 44100 },
} satisfies Record<string, { file: string; samples: number; rate: number }>;

export type MusicSlot = keyof typeof MUSIC;
