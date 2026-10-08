"use client";

import { useMemo } from "react";
import { FaceDisc } from "@/components/Avatar";
import { anonLook } from "@/lib/avatar";

/**
 * A face in chat. Named: the person's own look, on a neutral circle with a
 * hairline ring. Anonymous: a face generated from the alias, never their real
 * avatar (that is on the leaderboard and would give them away), with a dashed
 * ring so anon always reads as anon. Pass `caption` where there is room to
 * print "ANON" under it.
 */
export default function ChatFace({
  look,
  alias,
  size = 32,
  className,
  caption = false,
}: {
  look?: unknown;
  alias?: string | null;
  size?: number;
  className?: string;
  caption?: boolean;
}) {
  const anon = !look && !!alias;
  const face = useMemo(() => (anon ? anonLook(alias!) : look ?? null), [anon, alias, look]);
  const disc = <FaceDisc look={face} size={size} anon={anon} className={className} />;
  if (!anon || !caption) return disc;
  return (
    <span className="flex flex-none flex-col items-center gap-1">
      {disc}
      <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-dim">ANON</span>
    </span>
  );
}
