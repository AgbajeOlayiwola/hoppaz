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
  "talkingDrum:common": "box_burst_common.mp3", // box_burst_common
  "talkingDrum:rare": "box_burst_rare.mp3", // box_burst_rare
  "talkingDrum:epic": "box_burst_epic.mp3", // box_burst_epic
  "talkingDrum:legendary": "synth", // box_burst_legendary
  "talkingDrum:legendPhrase": "box_legend_phrase.mp3", // box_legend_phrase
  rip: "synth", // box_wrapper_rip
  shekere: "box_shekere_shake.mp3", // box_shekere_shake
  swish: "box_swish.wav", // box_swish
  // level up
  crowdEhn: "synth", // levelup_crowd_ehn
  sparkle: "levelup_sparkle.wav", // levelup_sparkle
  // Play, the bus, the Hoppaz three
  "talkingDrum:call": "play_enter_drum_call.mp3", // play_enter_drum_call
  "talkingDrum:exit": "synth", // play_exit_drum
  danfoHorn: "synth", // danfo_horn_sss
  hoppaz_three_full: "hoppaz_three_full.mp3", // hoppaz_three_full
  hoppaz_three_short: "hoppaz_three_short.mp3", // hoppaz_three_short
  // rewards
  chime: "reward_chime.mp3", // reward_chime
  fly: "reward_fly.wav", // reward_fly
  fill: "xp_fill.mp3", // xp_fill
  stamp: "synth", // streak_stamp
  coin: "synth", // quest_done_coin
  checkin_stamp: "checkin_stamp.wav", // checkin_stamp
  we_outside_ehn: "we_outside_ehn.mp3", // we_outside_ehn
  wave_received: "wave_received.mp3", // wave_received
  hotspot_enter: "hotspot_enter.mp3", // hotspot_enter
  rise: "synth", // box_appears_rise
  "agogo:0": "synth", // box_in_reach_agogo
  // small UI
  click: "card_land_click.wav", // card_land_click
  flip: "synth", // card_flip
  tick: "synth", // count_up_tick
  knock: "synth", // box_far_knock
  "agogo:3": "synth", // deck_snap
  box_alert: "box_alert.mp3", // box_alert
  toast_ok: "toast_ok.wav", // toast_ok
  toast_error: "toast_error.wav", // toast_error
  vibe_sticker_pop: "vibe_sticker_pop.wav", // vibe_sticker_pop
  tab_tick: "tab_tick.wav", // tab_tick
} satisfies Record<string, string>;

export type PickKey = keyof typeof PICKS;
