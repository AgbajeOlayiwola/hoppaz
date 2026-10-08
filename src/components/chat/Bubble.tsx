"use client";

import clsx from "clsx";

const LAGOS = "Africa/Lagos";

const dayOf = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: LAGOS });

/** "23:41" for today, "FRI 23:41" for anything older. Lagos time, DM Mono. */
export function chatTime(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const clock = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: LAGOS });
  if (dayOf(d) === dayOf(new Date(now))) return clock;
  const day = d.toLocaleDateString("en-NG", { weekday: "short", timeZone: LAGOS }).toUpperCase();
  return `${day} ${clock}`;
}

/** For inbox rows: "23:41" today, "FRI" this week, "18 OCT" before that. */
export function rowTime(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (dayOf(d) === dayOf(new Date(now))) {
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: LAGOS });
  }
  const age = now - d.getTime();
  if (age < 6 * 24 * 3.6e6) return d.toLocaleDateString("en-NG", { weekday: "short", timeZone: LAGOS }).toUpperCase();
  return d.toLocaleDateString("en-NG", { day: "numeric", month: "short", timeZone: LAGOS }).toUpperCase();
}

/**
 * One chat bubble. Deliberately plain: ground colours only (theirs on the card
 * colour, yours on the raised colour with a hairline), Archivo for the words,
 * DM Mono for the author and the time. Nothing here is orange, because nothing
 * here is a button.
 */
export default function Bubble({
  own,
  author,
  handle,
  anon,
  time,
  body,
  image,
  imageAlt,
  imageLoading,
  className,
}: {
  own: boolean;
  /** Dim mono caps line above the words. Leave out in a private chat. */
  author?: string;
  handle?: string | null;
  anon?: boolean;
  time?: string;
  body?: string | null;
  /** Signed URL once it has arrived. */
  image?: string | null;
  imageAlt?: string;
  /** True while a picture is expected but its URL has not arrived. */
  imageLoading?: boolean;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "min-w-0 max-w-[82%] rounded-hz border border-line px-3 py-2 text-left",
        own ? "bg-ink-2" : "bg-ink-3",
        className
      )}
    >
      {author && (
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase leading-tight tracking-[0.1em] text-dim">
          <span className="min-w-0 truncate">{author}</span>
          {anon && <span className="flex-none rounded-[3px] border border-line px-1 leading-[14px]">ANON</span>}
          {handle && !own && <span className="min-w-0 truncate normal-case tracking-normal">@{handle}</span>}
        </span>
      )}
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed URL from private storage
        <img src={image} alt={imageAlt ?? "Picture"} loading="lazy" className="mt-1.5 max-h-60 w-full rounded-hz object-cover" />
      ) : (
        imageLoading && <span className="mt-1.5 block h-32 w-40 rounded-hz border border-line bg-ink" aria-label="Loading picture" />
      )}
      {body && <span className={clsx("block break-words font-body text-[15px] leading-snug text-cream", (author || image || imageLoading) && "mt-1")}>{body}</span>}
      {time && <span className="mt-1 block text-right font-mono text-[10px] leading-none text-dim">{time}</span>}
    </span>
  );
}
