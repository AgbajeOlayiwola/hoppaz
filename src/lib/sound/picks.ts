/**
 * Which sound plays for each sfx voice: a file in public/sfx/ (the shipped copy of
 * a pick from public/sfx/try/) or "synth", the Web Audio voice in sfx.ts.
 *
 * The key is the voice call. "talkingDrum:common" is sfx.talkingDrum("common"),
 * "agogo:0" is sfx.agogo(0), "coin" is sfx.coin(). A cue that has no voice of its
 * own keeps its cue name ("checkin_stamp" is sfx.checkin(), "toast_ok" is
 * sfx.toast("ok")). The comment after each entry is the cue in
 * public/sfx/try/manifest.json, and apply-picks.mjs reads it.
 *
 * Each entry says three things:
 *   file  the shipped file, or "synth"
 *   g     the trim: the gain the file plays at so it sits where the synth voice it
 *         replaces sits, inside its lane (see Levels in docs/SOUND-FILES.md)
 *   aim   where that is, as the loudness of the trimmed file in LUFS before the master
 *         and the lane. g = 10^((aim - the take's LUFS in manifest.json) / 20), which is
 *         how apply-picks.mjs trims a different take. A synth entry keeps its aim and
 *         has g 1.
 *
 * Do not edit the values by hand:
 *   node scripts/sfx/apply-picks.mjs "box_burst_common:2 coin:synth"
 * copies the picked files to public/sfx/ and rewrites this table, trim included. A new
 * voice gets a new line here (and an entry in META in samples.ts). See docs/SOUND-FILES.md.
 */
export const PICKS = {
  // the box opens
  "talkingDrum:common": { file: "box_burst_common.mp3", g: 0.621, aim: -24 }, // box_burst_common
  "talkingDrum:rare": { file: "box_burst_rare.mp3", g: 0.379, aim: -24.9 }, // box_burst_rare
  "talkingDrum:epic": { file: "box_burst_epic.mp3", g: 0.708, aim: -21.8 }, // box_burst_epic
  "talkingDrum:legendary": { file: "synth", g: 1, aim: -21.9 }, // box_burst_legendary
  "talkingDrum:legendPhrase": { file: "box_legend_phrase.mp3", g: 0.712, aim: -22.3 }, // box_legend_phrase
  rip: { file: "synth", g: 1, aim: -37.1 }, // box_wrapper_rip
  shekere: { file: "box_shekere_shake.mp3", g: 0.204, aim: -27.2 }, // box_shekere_shake
  swish: { file: "box_swish.wav", g: 0.106, aim: -39.3 }, // box_swish
  // level up
  crowdEhn: { file: "synth", g: 1, aim: -23.3 }, // levelup_crowd_ehn
  sparkle: { file: "levelup_sparkle.wav", g: 0.188, aim: -32.9 }, // levelup_sparkle
  // Play, the bus, the Hoppaz three
  "talkingDrum:call": { file: "play_enter_drum_call.mp3", g: 0.633, aim: -22.6 }, // play_enter_drum_call
  "talkingDrum:exit": { file: "synth", g: 1, aim: -24.7 }, // play_exit_drum
  danfoHorn: { file: "synth", g: 1, aim: -23.9 }, // danfo_horn_sss
  hoppaz_three_full: { file: "hoppaz_three_full.mp3", g: 0.708, aim: -18.5 }, // hoppaz_three_full
  hoppaz_three_short: { file: "hoppaz_three_short.mp3", g: 0.492, aim: -21.5 }, // hoppaz_three_short
  // rewards
  chime: { file: "reward_chime.mp3", g: 0.148, aim: -31.1 }, // reward_chime
  fly: { file: "reward_fly.wav", g: 0.025, aim: -44.3 }, // reward_fly
  fill: { file: "xp_fill.mp3", g: 0.107, aim: -36.7 }, // xp_fill
  stamp: { file: "synth", g: 1, aim: -28.3 }, // streak_stamp
  coin: { file: "synth", g: 1, aim: -33.6 }, // quest_done_coin
  checkin_stamp: { file: "checkin_stamp.wav", g: 0.406, aim: -27.3 }, // checkin_stamp
  we_outside_ehn: { file: "we_outside_ehn.mp3", g: 0.164, aim: -28.7 }, // we_outside_ehn
  wave_received: { file: "wave_received.mp3", g: 0.25, aim: -31.5 }, // wave_received
  hotspot_enter: { file: "hotspot_enter.mp3", g: 0.179, aim: -27 }, // hotspot_enter
  rise: { file: "synth", g: 1, aim: -43.1 }, // box_appears_rise
  "agogo:0": { file: "synth", g: 1, aim: -34.5 }, // box_in_reach_agogo
  // small UI
  click: { file: "card_land_click.wav", g: 0.138, aim: -43.5 }, // card_land_click
  flip: { file: "synth", g: 1, aim: -43.3 }, // card_flip
  tick: { file: "synth", g: 1, aim: -44.1 }, // count_up_tick
  knock: { file: "synth", g: 1, aim: -36.3 }, // box_far_knock
  "agogo:3": { file: "synth", g: 1, aim: -33.6 }, // deck_snap
  box_alert: { file: "box_alert.mp3", g: 0.211, aim: -28.4 }, // box_alert
  toast_ok: { file: "toast_ok.wav", g: 0.318, aim: -28.1 }, // toast_ok
  toast_error: { file: "toast_error.wav", g: 0.197, aim: -31 }, // toast_error
  vibe_sticker_pop: { file: "vibe_sticker_pop.wav", g: 0.115, aim: -35.2 }, // vibe_sticker_pop
  tab_tick: { file: "tab_tick.wav", g: 0.117, aim: -35.1 }, // tab_tick
} satisfies Record<string, { file: string; g: number; aim: number }>;

export type PickKey = keyof typeof PICKS;
