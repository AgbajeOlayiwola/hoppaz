import type { MascotState } from "@/components/Mascot";

/**
 * The first-run tour, as data. Paz the Conductor walks a new Hopper round the
 * app in this order. Which step is current is never stored: it is worked out
 * (machine.ts) from what the Hopper has seen, what has happened (the facts) and
 * where they are right now (the context). That is what makes skipping, resuming
 * and replaying the same code path.
 */

export type StepId =
  | "welcome"
  | "install"
  | "locate"
  | "no_location"
  | "outside"
  | "face"
  | "box1"
  | "box2"
  | "box_far"
  | "spawns"
  | "alerts"
  | "leave_play"
  | "deck_go"
  | "deck"
  | "chat"
  | "crew_go"
  | "crew"
  | "me_go"
  | "me";

/** The `data-intro="..."` names the spotlight can point at. An element may carry several, space separated. */
export const INTRO_TARGETS = [
  "avatar", // your face on the map (tapping it enters Play)
  "locate", // the locate button on the map
  "install", // an install entry point (the Me row or the sheet's button)
  "alerts", // the alerts control (Me, or the HUD pill)
  "box", // a welcome box you can tap (any unopened one)
  "far-box", // the far welcome box
  "play-exit", // the arrow that leaves Play
  "today-tab", // the TODAY tab in the bottom bar
  "deck", // the Today deck
  "event-chat", // the EVENT CHAT link on the event card
  "crew-tab", // the CREW tab
  "me-tab", // the ME tab
] as const;
export type IntroTarget = (typeof INTRO_TARGETS)[number];

export const targetSelector = (t: IntroTarget) => `[data-intro~="${t}"]`;

/** What a button on the card can do. The handlers are registered in actions.ts. */
export type IntroActionName = "install" | "locate" | "alerts" | "send_avatar";

export type StepDef = {
  id: StepId;
  /** start: the map before Play. boxes: Play. events: Today, the event, Crew and Me. */
  part: "start" | "boxes" | "events";
  mascot: MascotState;
  /** The first one found on screen gets the spotlight. */
  targets: IntroTarget[];
  /** The big orange button: it either moves on, or runs an action. No cta means the Hopper does the thing itself. */
  cta?: { kind: "advance" } | { kind: "action"; action: IntroActionName };
  /** Only on a route that matches (the path, without the query). Omitted means anywhere. */
  route?: RegExp;
  /** Hidden while the target is not on screen (it lives inside a sheet or a card that has to be open). */
  needsTarget?: boolean;
  /** Needs Play to be open (a box step). Out of Play it asks the Hopper to tap their face again. */
  needsPlay?: boolean;
  /** Skipping this step also skips these (they make no sense alone). */
  skipAlso?: StepId[];
  /** A small Paz that only peeks over the card, for screens where her big head would cover what the Hopper has to read. */
  compact?: boolean;
  /** The screen keeps room for the card: it sets --intro-reserve (px) on the page root while the step shows (Today uses it). */
  reserve?: boolean;
};

const MAP = /^\/$/;

export const STEPS: ReadonlyArray<StepDef> = [
  { id: "welcome", part: "start", mascot: "wave", targets: [], cta: { kind: "advance" }, route: MAP },
  { id: "install", part: "start", mascot: "oya", targets: ["install"], cta: { kind: "action", action: "install" }, route: MAP },
  { id: "locate", part: "start", mascot: "point", targets: ["locate"], cta: { kind: "action", action: "locate" }, route: MAP },
  { id: "no_location", part: "start", mascot: "oops", targets: [], cta: { kind: "advance" }, route: MAP },
  { id: "outside", part: "start", mascot: "welcome", targets: [], cta: { kind: "advance" }, route: MAP },
  { id: "face", part: "start", mascot: "point", targets: ["avatar"], route: MAP, skipAlso: ["box1", "box2", "box_far", "spawns"] },
  { id: "box1", part: "boxes", mascot: "welcome", targets: ["box"], route: MAP, needsPlay: true },
  { id: "box2", part: "boxes", mascot: "celebrate", targets: ["box"], route: MAP, needsPlay: true },
  { id: "box_far", part: "boxes", mascot: "oya", targets: ["far-box"], cta: { kind: "action", action: "send_avatar" }, route: MAP, needsPlay: true },
  { id: "spawns", part: "boxes", mascot: "secret", targets: [], cta: { kind: "advance" }, route: MAP, needsPlay: true },
  { id: "alerts", part: "boxes", mascot: "oya", targets: ["alerts"], cta: { kind: "action", action: "alerts" }, route: MAP },
  { id: "leave_play", part: "boxes", mascot: "point", targets: ["play-exit"], route: MAP },
  { id: "deck_go", part: "events", mascot: "point", targets: ["today-tab"], skipAlso: ["deck"] },
  { id: "deck", part: "events", mascot: "welcome", targets: ["deck"], route: /^\/discover/, compact: true, reserve: true },
  { id: "chat", part: "events", mascot: "secret", targets: ["event-chat"], needsTarget: true, compact: true },
  { id: "crew_go", part: "events", mascot: "point", targets: ["crew-tab"], skipAlso: ["crew"] },
  { id: "crew", part: "events", mascot: "celebrate", targets: [], cta: { kind: "advance" }, route: /^\/crew/ },
  { id: "me_go", part: "events", mascot: "point", targets: ["me-tab"] },
  { id: "me", part: "events", mascot: "win", targets: [], cta: { kind: "advance" } },
];

export const STEP_IDS: ReadonlyArray<StepId> = STEPS.map((s) => s.id);
export const stepDef = (id: StepId): StepDef => STEPS.find((s) => s.id === id)!;

/* ------------------------------------------------------------------ events -- */

/**
 * Everything the tour listens to. The wiring calls introEvent("box_opened") and
 * friends; events can arrive in any order and at any time (before their step is
 * the current one is fine: they are remembered as facts).
 */
export type IntroEventName =
  | "map_ready" //          the events map is up (also fired again each time the map page mounts)
  | "location_granted" //   payload { lat, lng } when known
  | "location_denied"
  | "location_needed" //    the Hopper tried something that needs location and it is off: ask again
  | "outside_lagos" //      the Hopper is not in Lagos (location_granted with lat and lng works out the same)
  | "play_entered"
  | "play_exited"
  | "box_opened" //         one box was opened and its reveal finished
  | "welcome_done" //       all three welcome boxes are open
  | "install_done" //       Hoppaz was added to the home screen
  | "alerts_on"
  | "alerts_denied"
  | "deck_viewed" //        the Today deck is on screen
  | "event_opened" //       an event card or sheet was opened
  | "chat_opened" //        an event chat was opened
  | "crew_viewed" //        the Crew page is on screen
  | "me_viewed"; //         the Me page is on screen

export type IntroEventPayload = { lat?: number; lng?: number };
