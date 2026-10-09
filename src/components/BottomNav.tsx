"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Map, CalendarDays, Users, MessageSquare, CircleUserRound, type LucideIcon } from "lucide-react";
import clsx from "clsx";
import { usePlayMode } from "@/lib/usePlayMode";

type Tab = { href: string; label: string; Icon: LucideIcon; intro?: string };

const TABS: ReadonlyArray<Tab> = [
  { href: "/", label: "MAP", Icon: Map },
  { href: "/discover", label: "TODAY", Icon: CalendarDays, intro: "today-tab" },
  { href: "/crew", label: "CREW", Icon: Users, intro: "crew-tab" },
  { href: "/chat", label: "CHAT", Icon: MessageSquare },
  { href: "/me", label: "ME", Icon: CircleUserRound, intro: "me-tab" },
];

/** Sub-pages keep their parent tab lit, so you always know where you are. */
const PARENT: Array<[string, string]> = [
  ["/drop", "/"],
  ["/event", "/"],
  ["/quests", "/me"],
  ["/drops", "/me"],
  ["/collection", "/me"],
  ["/privacy", "/me"],
  ["/community", "/me"],
  ["/account", "/me"],
];

/** Full-screen tasks hide the tab bar, the way a chat hides WhatsApp's tabs. */
const FULL_SCREEN = [/^\/chat\/dm\//, /^\/drop$/, /^\/me\/avatar/, /^\/admin/, /^\/report\//, /^\/phone/];

export default function BottomNav() {
  const path = usePathname();
  // Play has the whole screen: the map closes around you and the tab bar steps out.
  const playing = usePlayMode((s) => s.active);
  if (playing || FULL_SCREEN.some((re) => re.test(path))) return null;
  const parent = PARENT.find(([p]) => path === p || path.startsWith(`${p}/`))?.[1];
  const active = parent ?? path;
  return (
    <nav
      className="z-30 flex flex-none border-t border-line bg-ink-2"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      aria-label="Main"
    >
      {TABS.map(({ href, label, Icon, intro }) => {
        const on = href === "/" ? active === "/" : active === href || active.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            data-intro={intro}
            aria-current={on ? "page" : undefined}
            className={clsx(
              "flex min-h-[52px] flex-1 flex-col items-center justify-center gap-1 transition-colors",
              on ? "text-orange" : "text-dim"
            )}
          >
            <Icon size={19} strokeWidth={on ? 2.4 : 1.9} aria-hidden />
            <span className="font-mono text-[10px] font-medium tracking-[0.1em]">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
