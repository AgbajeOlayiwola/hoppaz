"use client";

import Link from "next/link";
import clsx from "clsx";
import { Shirt } from "lucide-react";
import Avatar from "@/components/Avatar";
import Mascot, { type MascotState } from "@/components/Mascot";

/**
 * The top of Me: your face (tap to dress), your name, one mono line with your
 * level and its title (and CAPTAIN once you make it), and the small permanent
 * mascot whose mood tells you how you are doing.
 */
export default function MeHeader({
  look,
  name,
  levelNo,
  level,
  status,
  mascot,
  stampLevel,
  belowCard,
}: {
  look: unknown;
  name: string;
  /** 1 for the first rung of the XP ladder. */
  levelNo: number;
  /** The rung's title (JJC, REGULAR ...). */
  level: string;
  status: "HOPPER" | "CAPTAIN";
  mascot: MascotState;
  /** The level changed since you last looked: it stamps in once. */
  stampLevel: boolean;
  /** The month card sits above and already clears the status bar. */
  belowCard?: boolean;
}) {
  // The mascot is cream. On the cream day ground it needs the ink edge to be seen at all.
  // That is done in CSS off <html data-theme>, so the server and the browser render the same markup.
  return (
    <header className={clsx("flex items-center gap-3.5 pb-5", belowCard ? "pt-5" : "pad-top")}>
      <div className="relative flex-none">
        <Link
          href="/me/avatar"
          aria-label="Dress your Hopper"
          className="block h-16 w-16 overflow-hidden rounded-full border border-line bg-ink-3"
        >
          <Avatar look={look} crop="head" />
        </Link>
        <span
          aria-hidden
          className="absolute -bottom-0.5 -right-0.5 grid h-[22px] w-[22px] place-items-center rounded-full border border-line bg-ink-2 text-dim"
        >
          <Shirt size={12} strokeWidth={2} />
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <h1 className="truncate font-display text-[26px] font-black leading-[1.1]">{name}</h1>
        <p className={clsx("seclabel mt-1.5 whitespace-nowrap", stampLevel && "animate-stamp")}>
          LVL {levelNo} · {level}
          {status === "CAPTAIN" && " · CAPTAIN"}
        </p>
      </div>
      <Mascot
        state={mascot}
        size={64}
        className="flex-none [[data-theme=day]_&]:[--rig-edge:#0E0B0A]"
        label={`The Hoppaz mascot, ${mascot === "sleep" ? "asleep" : mascot === "celebrate" ? "celebrating" : mascot === "wave" ? "waving" : "waiting"}`}
      />
    </header>
  );
}
