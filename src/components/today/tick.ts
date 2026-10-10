import { sfx } from "@/lib/sound/sfx";
import { haptics } from "@/lib/haptics";

/**
 * The deck landing on a card. No sound: Jae found the slide tick annoying (9 Oct),
 * so sliding left and right is silent. A phone that can buzz still gives a 6 ms tap
 * (haptics.ts, so the Buzz switch and its rules apply), unless sound is muted.
 */
export function snapTick() {
  if (!sfx.isMuted()) haptics.buzz("snap");
}
