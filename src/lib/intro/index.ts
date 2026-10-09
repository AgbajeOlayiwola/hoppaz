/**
 * Paz's first-run tour. Import from here.
 *
 *   introEvent("box_opened")       tell the tour something happened (the wiring's one call)
 *   registerIntroAction(...)       replace what a button does (locate, send_avatar, ...)
 *   introReplay()                  the Replay the tour row on Me
 *   <IntroHost />                  from "@/components/intro/IntroHost", mounted once in layout.tsx
 *
 * See docs/INTRO.md.
 */
export { introEvent, onIntroEvent, introReplay, introSkip, introAdvance, introPauseTour, introReset, useIntro, introHasRun, introAsksLocation, INTRO_EVENT } from "./store";
export { registerIntroAction, runIntroAction } from "./actions";
export { REPLAY_ROW, LINES, EXTRA, HAS_CARDS } from "./lines";
export { STEPS, STEP_IDS, INTRO_TARGETS, targetSelector } from "./steps";
export type { IntroEventName, IntroEventPayload, IntroTarget, StepId, IntroActionName } from "./steps";
