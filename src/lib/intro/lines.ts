import type { StepId } from "./steps";

/**
 * Everything Paz says, in one place. Short words, second person, a little
 * Lagos. Title is the bold bit, line is the speech. No long words, no
 * exclamation marks stacked two deep, nothing that sounds like a form.
 *
 * Rewards: today a box pays XP and a collectible. When the card deck ships,
 * flip HAS_CARDS and every line that names the prize says "a card" instead.
 */
export const HAS_CARDS = false;
const PRIZE = HAS_CARDS ? "XP and a card" : "XP and a collectible";

export type Line = {
  title: string;
  line: string;
  /** The orange button, when the step has one. */
  cta?: string;
  /** The small skip under the button. */
  skip?: string;
};

export const LINES: Record<StepId, Line> = {
  welcome: {
    title: "Oya, welcome!",
    line: "I'm Paz, your conductor. Every dot on this map is something to do near you.",
    cta: "Show me",
    skip: "Skip",
  },
  install: {
    title: "Keep me close",
    line: "Put Hoppaz on your home screen. It opens quick, and I can ping you.",
    cta: "Add it",
    skip: "Later",
  },
  open_app: {
    title: "Now open Hoppaz",
    line: "Tap my icon on your home screen. I'll meet you there, oya!",
    skip: "Carry on in the browser",
  },
  locate: {
    title: "Let's find you",
    line: "Turn on your location and watch the map fly to you.",
    cta: "Find me",
    skip: "Not now",
  },
  no_location: {
    title: "No wahala",
    line: "Boxes need your location, so I'll ask again later. Events first!",
    cta: "To the events",
    skip: "Skip",
  },
  outside: {
    title: "Ah, you're far!",
    line: "Boxes live in Lagos, but you can still peep what's on. Come, let me show you.",
    cta: "Show me",
    skip: "Skip",
  },
  face: {
    title: "Tap your face",
    line: "That's you on the map. Tap it to see the cool stuff!",
    skip: "Skip",
  },
  box1: {
    title: "Free boxes!",
    line: "Three welcome boxes, all yours. Tap the first one!",
    skip: "Skip",
  },
  box2: {
    title: "Lucky you!",
    line: `${PRIZE}, just like that. Never a "try again" here. Next box, oya!`,
    skip: "Skip",
  },
  box_far: {
    title: "That one's far",
    line: "Too far to walk? Send your avatar, oya!",
    cta: "Send it",
    skip: "Skip",
  },
  keep: {
    title: "Keep your Golden Danfo",
    line: "Make an account so it stays yours, even on your home screen. Got one already? Log in.",
    cta: "Sign up or log in",
    skip: "Later",
  },
  spawns: {
    title: "Boxes drop all day",
    line: "More boxes pop up near you and stay open for a while. Wave, vibe, link up.",
    cta: "Got it",
    skip: "Skip",
  },
  alerts: {
    title: "Want a ping?",
    line: "I'll buzz you when a box drops near you.",
    cta: "Turn on alerts",
    skip: "Later",
  },
  leave_play: {
    title: "Back to the street",
    line: "Tap the arrow to leave Play. Tonight's events are next.",
    skip: "Skip",
  },
  deck_go: {
    title: "What's on tonight?",
    line: "Tap Today and let's see the events.",
    skip: "Skip",
  },
  deck: {
    title: "Swipe and tap",
    line: "Swipe right if we outside, left if it's a nah. They come round again. Tap one for the full gist.",
    skip: "Skip",
  },
  chat: {
    title: "Every event has a chat",
    line: "That's where your crew forms. Tap the chat!",
    skip: "Skip",
  },
  crew_go: {
    title: "Meet the crews",
    line: "Tap Crew and I'll show you how it works.",
    skip: "Skip",
  },
  crew: {
    title: "Crew up",
    line: "Chat, link up, and you're a crew. Go out together and climb the board.",
    cta: "Got it",
    skip: "Skip",
  },
  me_go: {
    title: "Last stop",
    line: "Tap Me. Your streak and your shelf live there.",
    skip: "Skip",
  },
  me: {
    title: "You're set.",
    line: "Your streak, your shelf and your nights all live in Me. We outside!",
    cta: "We outside",
  },
};

/** Cards that replace a step's own words when the Hopper is somewhere else than the step expects. */
export const EXTRA = {
  /** A box step, but Play is closed. */
  backIn: {
    title: "Back in",
    line: "Tap your face to jump back into Play.",
    skip: "Skip",
  } satisfies Line,
  /** An events step, but Play is still open. */
  leavePlay: {
    title: "Back to the street",
    line: "Tap the arrow to leave Play first.",
    skip: "Skip",
  } satisfies Line,
  /** iPhone in Safari, no account yet: sign up first, so the account and the boxes come along to the installed app. */
  alertsNeedSignup: {
    title: "One thing first",
    line: "Alerts live in the home screen app. Sign up first, so your boxes come with you.",
    cta: "Sign up or log in",
    skip: "Later",
  } satisfies Line,
  /** iPhone in Safari with an account, not on the home screen yet: alerts only work from there. */
  alertsNeedInstall: {
    title: "Add me first",
    line: "Alerts work from the home screen. Two taps. Log in once there and all your boxes are waiting.",
    cta: "Done, I added it",
    skip: "Later",
  } satisfies Line,
  /** iPhone inside another app's browser (Instagram, TikTok and the like): there is no home screen to add to from there. */
  alertsNeedSafari: {
    title: "Open me in Safari",
    line: "Alerts need the home screen app. Open this page in Safari, then add me. Oya!",
    cta: "Got it",
    skip: "Later",
  } satisfies Line,
  /** The first card in the installed app, for a Hopper who just came over from the browser. */
  arrived: {
    title: "You made it!",
    line: "Hoppaz on your home screen, nice! Turn on your location and watch the map fly to you.",
    cta: "Find me",
    skip: "Not now",
  } satisfies Line,
  /** The iPhone install step: the two taps, with a picture. */
  installIos: {
    title: "Keep me close",
    line: "Two taps and I live on your home screen. I'll wait!",
    cta: "Done, I added it",
    skip: "Later",
  } satisfies Line,
  /** The iPhone stop card for a Hopper with an account. */
  openAppMember: {
    title: "Now open Hoppaz",
    line: "Tap my icon on your home screen and log in once. Your boxes and XP are all there!",
    skip: "Carry on in the browser",
  } satisfies Line,
  /** A gated thing was tried while Paz is touring (a toast: the sign-up sheet stays shut). */
  signupLater: "Sign up when our tour is done and that's yours!",
  /** The same, while Paz's own sign-up card is up. */
  signupOnCard: "Sign up on my card, or tap Later.",
  /** The picture on the iPhone cards, as words for a screen reader. */
  tapsLabel: "Tap Share in Safari, then Add to Home Screen",
  homeLabel: "The Hoppaz icon on your home screen",
  /** The locate button was tapped and the browser is asking. */
  locateWaiting: "Tap Allow on the pop-up. I'll wait.",
  /** Location was refused in the browser's own settings, so a tap cannot ask again. */
  locationBlocked: {
    title: "Location is off",
    line: "Switch it on for Hoppaz in your phone settings and I'll find you.",
    cta: "Okay",
  } satisfies Line,
  /** Asked again later, after a no or a skip (the nudge). */
  locationAgain: {
    title: "Boxes need your location",
    line: "Turn it on and I'll fly you to your boxes.",
    cta: "Turn on location",
    skip: "Not now",
  } satisfies Line,
  /** Replay mode: the boxes are already open, so Paz just talks. */
  replayCta: "Got it",
  /** A small toast-sized line for alerts that were refused. */
  alertsRefused: "No wahala. You can switch alerts on later in Me.",
  /** Alerts failed for a reason that may pass (no session yet, the server was busy): the step stays. */
  alertsRetry: "Could not switch alerts on. Try again in a moment.",
};

/** The Replay the tour row on Me. */
export const REPLAY_ROW = {
  title: "Replay the tour",
  hint: "Paz walks you round Hoppaz again.",
};
