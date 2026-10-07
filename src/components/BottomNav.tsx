"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Map, Flame, Users, MessageSquare, Star } from "lucide-react";
import clsx from "clsx";

const TABS = [
  { href: "/", label: "MAP", Icon: Map },
  { href: "/discover", label: "TONIGHT", Icon: Flame },
  { href: "/crew", label: "CREW", Icon: Users },
  { href: "/chat", label: "CHAT", Icon: MessageSquare },
  { href: "/me", label: "ME", Icon: Star },
] as const;

export default function BottomNav() {
  const path = usePathname();
  return (
    <nav
      className="flex-none flex border-t border-line bg-ink-2 z-30"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      aria-label="Main"
    >
      {TABS.map(({ href, label, Icon }) => {
        const on = href === "/"
          ? path === "/"
          : href === "/me"
            ? ["/me", "/quests", "/drops", "/collection"].some((route) => path === route || path.startsWith(`${route}/`))
            : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={on ? "page" : undefined}
            className={clsx(
              "flex-1 flex flex-col items-center gap-1 py-2.5 transition-colors",
              on ? "text-orange" : "text-dim"
            )}
          >
            <Icon size={17} strokeWidth={on ? 2.6 : 2} aria-hidden />
            <span className="font-mono text-[8px] font-bold tracking-[0.1em]">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
