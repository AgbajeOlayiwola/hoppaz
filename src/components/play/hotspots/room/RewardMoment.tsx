"use client";

import { useEffect, useState } from "react";
import StampMark from "@/components/me/StampMark";
import { haptics } from "@/lib/haptics";
import { sfx } from "@/lib/sound/sfx";

/** What the daily claim paid: the XP (0 on a repeat day) and the Regular badge when this stay earned it. */
export type Reward = { id: number; xp: number; badge: { key: string; name: string } | null; place: string; minutes: number };

const XP_MS = 2600;
const BADGE_MS = 4200;

/**
 * The reward moment (docs/HOTSPOTS.md section 8): "+10 XP" lands with the reward sound after the stay, and on
 * the day a stay earns the Regular badge a stamp follows it. It sits over the room, takes no taps, and
 * leaves by itself. The sounds are the check-in pair (the thump and the two-note motif) and, for the stamp, the
 * stamp and the full motif.
 */
export default function RewardMoment({ reward }: { reward: Reward | null }) {
  const [step, setStep] = useState<"xp" | "badge" | null>(null);

  useEffect(() => {
    if (!reward) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const xp = () => {
      setStep("xp");
      sfx.checkin();
      haptics.buzz("checkin");
      timers.push(setTimeout(() => sfx.motif("short"), 180));
    };
    const badge = () => {
      setStep("badge");
      sfx.stamp();
      haptics.buzz("stampSmall");
      timers.push(setTimeout(() => sfx.motif("full"), 220));
    };
    if (reward.xp > 0) {
      xp();
      if (reward.badge) timers.push(setTimeout(badge, XP_MS + 250));
      timers.push(setTimeout(() => setStep(null), XP_MS + (reward.badge ? 250 + BADGE_MS : 0)));
    } else if (reward.badge) {
      badge();
      timers.push(setTimeout(() => setStep(null), BADGE_MS));
    }
    return () => timers.forEach(clearTimeout);
  }, [reward]);

  return (
    <div className="pointer-events-none absolute inset-x-0 top-[22%] z-[41] flex justify-center px-4" role="status" aria-live="polite">
      {reward && step === "xp" && (
        <div key="xp" className="animate-stamp rounded-hz border border-line bg-ink-2 px-8 py-4 text-center shadow-sheet">
          <p className="num text-[44px]">+{reward.xp} XP</p>
          <p className="seclabel mt-2">{reward.minutes} minutes at {reward.place}</p>
        </div>
      )}
      {reward?.badge && step === "badge" && (
        <div key="badge" className="flex animate-stamp items-center gap-4 rounded-hz border border-line bg-ink-2 px-6 py-4 shadow-sheet">
          <StampMark stamp size={64} />
          <div className="min-w-0">
            <p className="font-display text-[20px] font-black leading-tight">{reward.badge.name}</p>
            <p className="hint mt-1">Four days here this month. You belong.</p>
          </div>
        </div>
      )}
    </div>
  );
}
