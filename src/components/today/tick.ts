import { sfx } from "@/lib/sound/sfx";

/**
 * The little agogo tick when the deck lands on a card: a short bell hit going
 * forward, a lower soft one going back. It goes through the app's own sound
 * (sfx.ts), so it follows its mute switch (the sound button on Today) and stays
 * silent until the Hopper has touched the screen once (a browser will not play
 * sound before that anyway). A phone that can buzz gives a 6 ms tap too, unless
 * sound is muted: the switch silences the buzz as well.
 */
export function snapTick(dir: 1 | -1) {
  try {
    if (!sfx.isMuted() && navigator.vibrate && navigator.userActivation?.hasBeenActive) navigator.vibrate(6);
  } catch {
    /* no vibration here */
  }
  if (dir > 0) sfx.agogo(3);
  else {
    sfx.tone(784, 0.16, "sine", 0.1);
    sfx.tone(1180, 0.1, "sine", 0.05);
  }
}
