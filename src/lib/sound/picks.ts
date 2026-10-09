/**
 * Which sound plays for each sfx voice: a file in public/sfx/ (the shipped copy of
 * a pick from public/sfx/try/) or "synth", the Web Audio voice in sfx.ts.
 *
 * The key is the voice call. "talkingDrum:common" is sfx.talkingDrum("common"),
 * "agogo:0" is sfx.agogo(0), "coin" is sfx.coin(). A cue with no voice yet keeps
 * its cue name and plays through sfx.cue(name). The comment after each entry is
 * the cue in public/sfx/try/manifest.json, and apply-picks.mjs reads it.
 *
 * Every entry is "synth" until a pick is applied. Do not edit the values by hand:
 *   node scripts/sfx/apply-picks.mjs "box_burst_common:2 coin:synth"
 * copies the picked files to public/sfx/ and rewrites this table. A new voice gets a
 * new line here (and an entry in META in samples.ts). See docs/SOUND-FILES.md.
 */
export const PICKS = {
  // the box opens
  "talkingDrum:common": "synth", // box_burst_common
  "talkingDrum:rare": "synth", // box_burst_rare
  "talkingDrum:epic": "synth", // box_burst_epic
  "talkingDrum:legendary": "synth", // box_burst_legendary
  "talkingDrum:legendPhrase": "synth", // box_legend_phrase
  rip: "synth", // box_wrapper_rip
  shekere: "synth", // box_shekere_shake
  swish: "synth", // box_swish
  // level up
  crowdEhn: "synth", // levelup_crowd_ehn
  sparkle: "synth", // levelup_sparkle
  // Play, the bus, the Hoppaz three
  "talkingDrum:call": "synth", // play_enter_drum_call
  "talkingDrum:exit": "synth", // play_exit_drum
  danfoHorn: "synth", // danfo_horn_sss
  hoppaz_three_full: "synth", // hoppaz_three_full
  hoppaz_three_short: "synth", // hoppaz_three_short
  // rewards
  chime: "synth", // reward_chime
  fly: "synth", // reward_fly
  fill: "synth", // xp_fill
  stamp: "synth", // streak_stamp
  coin: "synth", // quest_done_coin
  checkin_stamp: "synth", // checkin_stamp
  we_outside_ehn: "synth", // we_outside_ehn
  wave_received: "synth", // wave_received
  hotspot_enter: "synth", // hotspot_enter
  rise: "synth", // box_appears_rise
  "agogo:0": "synth", // box_in_reach_agogo
  // small UI
  click: "synth", // card_land_click
  flip: "synth", // card_flip
  tick: "synth", // count_up_tick
  knock: "synth", // box_far_knock
  "agogo:3": "synth", // deck_snap
  box_alert: "synth", // box_alert
  toast_ok: "synth", // toast_ok
  toast_error: "synth", // toast_error
  vibe_sticker_pop: "synth", // vibe_sticker_pop
  tab_tick: "synth", // tab_tick
} satisfies Record<string, string>;

export type PickKey = keyof typeof PICKS;
