"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import clsx from "clsx";
import type { MouseEvent, ReactNode } from "react";

/**
 * The one header pattern.
 *
 *   Tab page (Map, Today, Crew, Chat, Me): no `back`. A big Poppins Black title
 *   and an optional DM Mono caption.
 *
 *   Sub-page (Privacy, Rules, Account...): pass `back`. A 44px chevron that
 *   returns to wherever you came from (router.back), the title, and at most one
 *   `action` on the right. `back` can be the fallback href for when there is
 *   nothing to go back to (a page opened from a shared link), e.g. back="/me".
 *   Use `backTo` when the chevron must always go to one place.
 *
 * The chevron is a real link, so open-in-new-tab and no-JS still work.
 */
export default function PageHeader({
  title,
  caption,
  back,
  backTo,
  action,
  className,
}: {
  title: string;
  /** DM Mono line under the title. */
  caption?: string;
  /** Show the chevron. A string is the fallback href when history is empty (default "/"). */
  back?: boolean | string;
  /** Always go here instead of back in history. Implies the chevron. */
  backTo?: string;
  /** At most one thing: an icon button or a small link. */
  action?: ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const showBack = !!back || !!backTo;
  const href = backTo ?? (typeof back === "string" ? back : "/");
  // Only same-site paths: a header never bounces anyone off the app.
  const safe = href.startsWith("/") && !href.startsWith("//") ? href : "/";

  const goBack = (e: MouseEvent<HTMLAnchorElement>) => {
    // Let "open in new tab" and friends do their thing.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    if (backTo) return router.push(safe);
    // The Navigation API only sees same-site entries, so a page opened from another site
    // (or a new tab) correctly has nowhere to go back to. Older browsers fall back to history length.
    const nav = (window as Window & { navigation?: { canGoBack: boolean } }).navigation;
    const canGoBack = nav ? nav.canGoBack : window.history.length > 1;
    if (canGoBack) router.back();
    else router.replace(safe);
  };

  return (
    <header className={clsx("pad-top flex items-center gap-1 pb-5", className)}>
      {showBack && (
        <Link
          href={safe}
          onClick={goBack}
          aria-label="Back"
          className="-ml-3 grid h-11 w-11 flex-none place-items-center text-cream"
        >
          <ChevronLeft size={26} strokeWidth={2.2} aria-hidden />
        </Link>
      )}
      <div className="min-w-0 flex-1">
        <h1 className={clsx("font-display font-black leading-none", showBack ? "text-[26px]" : "text-[32px]")}>{title}</h1>
        {caption && <p className="seclabel mt-1.5">{caption}</p>}
      </div>
      {action && <div className="flex-none">{action}</div>}
    </header>
  );
}
