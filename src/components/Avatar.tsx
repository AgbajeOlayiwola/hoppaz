"use client";

import { useId, useMemo } from "react";
import clsx from "clsx";
import { normalizeLook, type Look } from "@/lib/avatar";
import { avatarSvg } from "@/lib/avatarSvg";

/** A Hopper's look. `raw` can be anything from the database; it is normalized here. */
export default function Avatar({
  look,
  crop = "full",
  label,
  className,
}: {
  look: Look | unknown;
  crop?: "full" | "head";
  label?: string;
  className?: string;
}) {
  const uid = useId();
  const html = useMemo(
    () => avatarSvg(normalizeLook(look), { uid, crop, label }),
    [look, uid, crop, label]
  );
  return <span className={className ?? "block h-full w-full"} dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * A face on its neutral circle: the card ground and one hairline ring. A face
 * is not a button, so it never sits on orange, and violet is kept for drops,
 * so an anonymous face gets a dashed ring instead of a coloured disc.
 *
 * Pass `look` for a dressed Hopper (head crop). Pass `initial` for someone who
 * never dressed up: one letter in Poppins Black on the same circle, so the same
 * person looks the same on every screen.
 */
export function FaceDisc({
  look,
  initial,
  size = 36,
  anon = false,
  className,
}: {
  look?: Look | unknown;
  initial?: string;
  size?: number;
  anon?: boolean;
  className?: string;
}) {
  const letter = (initial ?? "").trim().charAt(0).toUpperCase() || "H";
  return (
    <span
      className={clsx(
        "block flex-none overflow-hidden rounded-full border bg-ink-3",
        anon ? "border-dashed border-dim" : "border-line",
        className
      )}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {look ? (
        <Avatar look={look} crop="head" />
      ) : (
        <span
          className="grid h-full w-full place-items-center font-display font-black leading-none text-cream"
          style={{ fontSize: Math.max(10, Math.round(size * 0.42)) }}
        >
          {letter}
        </span>
      )}
    </span>
  );
}
