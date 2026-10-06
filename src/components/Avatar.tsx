"use client";

import { useId, useMemo } from "react";
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
