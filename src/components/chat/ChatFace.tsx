"use client";

import { useMemo } from "react";
import clsx from "clsx";
import Avatar from "@/components/Avatar";
import { anonLook } from "@/lib/avatar";

/**
 * A face in chat. Named: the person's own look. Anonymous: a face generated
 * from the alias, never their real avatar (that is on the leaderboard and
 * would give them away), on a violet ground so anon always reads as anon.
 */
export default function ChatFace({
  look,
  alias,
  size = 32,
  className,
}: {
  look?: unknown;
  alias?: string | null;
  size?: number;
  className?: string;
}) {
  const anon = !look && !!alias;
  const face = useMemo(() => (anon ? anonLook(alias!) : look ?? null), [anon, alias, look]);
  return (
    <span
      className={clsx("block flex-none overflow-hidden rounded-full border", anon ? "border-violet bg-violet" : "border-orange bg-orange", className)}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <Avatar look={face} crop="head" />
    </span>
  );
}
