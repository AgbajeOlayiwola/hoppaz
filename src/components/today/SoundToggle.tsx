"use client";

import { useSyncExternalStore } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { sfx } from "@/lib/sound/sfx";

/**
 * The sound switch for the Today screen: the same one Play has (it is the app's
 * one mute, kept in the same place, so what a Hopper chose in Play holds here
 * and the other way round). The deck's agogo tick and its buzz both follow it.
 * A soft tick answers when sound comes back on, so the tap is heard.
 */
export default function SoundToggle({ className = "" }: { className?: string }) {
  const muted = useSyncExternalStore(sfx.subscribe, sfx.isMuted, () => false);
  return (
    <button
      type="button"
      onClick={() => {
        sfx.setMuted(!muted);
        if (muted) sfx.agogo(3);
      }}
      aria-label={muted ? "Sound is off. Turn sound on" : "Sound is on. Turn sound off"}
      aria-pressed={!muted}
      className={`grid h-11 w-11 flex-none place-items-center ${className}`}
    >
      <span className="grid h-9 w-9 place-items-center rounded-full border border-line bg-ink-2/70 text-cream transition-transform active:scale-[0.92]">
        {muted ? <VolumeX size={17} strokeWidth={2.2} aria-hidden /> : <Volume2 size={17} strokeWidth={2.2} aria-hidden />}
      </span>
    </button>
  );
}
