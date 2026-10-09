"use client";

import Link from "next/link";
import clsx from "clsx";
import { Shirt } from "lucide-react";
import Avatar from "@/components/Avatar";
import Mascot, { type MascotState } from "@/components/Mascot";

/**
 * The top of Me: your face (tap to dress), your name, ONE big level name, the
 * bus status as a small mono label with your stamp count, and the small
 * permanent mascot whose mood tells you how you are doing.
 */
export default function MeHeader({
  look,
  name,
  level,
  status,
  stamps,
  mascot,
  stampLevel,
}: {
  look: unknown;
  name: string;
  level: string;
  status: "HOPPER" | "CAPTAIN";
  stamps: number | null;
  mascot: MascotState;
  /** The level changed since you last looked: it stamps in once. */
  stampLevel: boolean;
}) {
  // The mascot is cream. On the cream day ground it needs the ink edge to be seen at all.
  // That is done in CSS off <html data-theme>, so the server and the browser render the same markup.
  return (
    <header className="pad-top flex items-center gap-3.5 pb-5">
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
        <p className="truncate font-body text-[15px] font-semibold leading-tight">{name}</p>
        <h1 className={clsx("mt-1 font-display text-[38px] font-black leading-none", stampLevel && "animate-stamp")}>
          {level}
        </h1>
        <p className="seclabel mt-2 whitespace-nowrap">
          {status}
          {stamps !== null && ` · ${stamps} ${stamps === 1 ? "STAMP" : "STAMPS"}`}
        </p>
      </div>
      <Mascot
        state={mascot}
        size={72}
        className="flex-none [[data-theme=day]_&]:[--rig-edge:#0E0B0A]"
        label={`The Hoppaz mascot, ${mascot === "sleep" ? "asleep" : mascot === "celebrate" ? "celebrating" : mascot === "wave" ? "waving" : "waiting"}`}
      />
    </header>
  );
}
