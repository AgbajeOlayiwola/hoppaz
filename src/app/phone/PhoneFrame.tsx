"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { ExternalLink, RotateCw } from "lucide-react";

/** Common phone screens, in CSS pixels. */
const DEVICES = [
  { key: "iphone", label: "iPhone 15", w: 393, h: 852 },
  { key: "iphone-max", label: "iPhone Pro Max", w: 430, h: 932 },
  { key: "iphone-se", label: "iPhone SE", w: 375, h: 667 },
  { key: "android", label: "Android", w: 360, h: 800 },
] as const;

const PAGES = [
  ["Map", "/"],
  ["Today", "/discover"],
  ["Crew", "/crew"],
  ["Chat", "/chat"],
  ["Me", "/me"],
  ["Drops", "/drops"],
  ["Admin", "/admin"],
] as const;

type Theme = "clock" | "day" | "night";
const BEZEL = 12;

/**
 * The phone preview: the app in an iframe at a real phone's size, scaled down
 * to fit the window. The iframe shares this tab's storage, so location, theme
 * and sign-in carry over between pages.
 */
export default function PhoneFrame() {
  const [device, setDevice] = useState<(typeof DEVICES)[number]>(DEVICES[0]);
  const [theme, setTheme] = useState<Theme>("clock");
  const [path, setPath] = useState("/");
  const [nonce, setNonce] = useState(0);
  const [scale, setScale] = useState(1);
  const frame = useRef<HTMLIFrameElement>(null);

  // Fit the whole phone in the window, toolbar included.
  useEffect(() => {
    const fit = () => setScale(Math.min(1, (window.innerHeight - 96) / (device.h + BEZEL * 2), (window.innerWidth - 32) / (device.w + BEZEL * 2)));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [device]);

  const src = `${path}${theme === "clock" ? "" : `${path.includes("?") ? "&" : "?"}theme=${theme}`}`;

  const pickTheme = (t: Theme) => {
    // ?theme= is remembered for the tab; going back to the Lagos clock means forgetting it.
    if (t === "clock") {
      try {
        sessionStorage.removeItem("hz-theme");
      } catch {
        /* storage blocked: the iframe keeps its theme until reload */
      }
    }
    setTheme(t);
    setNonce((n) => n + 1);
  };

  const chip = (on: boolean) =>
    clsx(
      "h-8 rounded-[6px] border px-2.5 font-mono text-[11px] uppercase tracking-[0.08em]",
      on ? "border-[#FF4D00] text-[#F5EBDD]" : "border-[#2E2320] text-[#9C9087] hover:text-[#F5EBDD]"
    );

  return (
    <div className="fixed inset-0 z-[90] flex flex-col items-center bg-[#0E0B0A] text-[#F5EBDD]">
      <div className="flex w-full flex-wrap items-center justify-center gap-2 px-4 py-3">
        <select
          aria-label="Phone"
          value={device.key}
          onChange={(e) => setDevice(DEVICES.find((d) => d.key === e.target.value) ?? DEVICES[0])}
          className="h-8 w-auto rounded-[6px] border border-[#2E2320] bg-[#171210] px-2 py-0 font-mono text-[11px] text-[#F5EBDD]"
        >
          {DEVICES.map((d) => (
            <option key={d.key} value={d.key}>
              {d.label} · {d.w}×{d.h}
            </option>
          ))}
        </select>
        {(["clock", "day", "night"] as const).map((t) => (
          <button key={t} type="button" className={chip(theme === t)} onClick={() => pickTheme(t)}>
            {t === "clock" ? "Lagos clock" : t}
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-[#2E2320]" aria-hidden />
        {PAGES.map(([label, href]) => (
          <button
            key={href}
            type="button"
            className={chip(path === href)}
            onClick={() => {
              setPath(href);
              setNonce((n) => n + 1);
            }}
          >
            {label}
          </button>
        ))}
        <button type="button" aria-label="Reload" className={chip(false)} onClick={() => setNonce((n) => n + 1)}>
          <RotateCw size={13} />
        </button>
        <a href={src} target="_blank" rel="noreferrer" aria-label="Open in a new tab" className={clsx(chip(false), "grid place-items-center")}>
          <ExternalLink size={13} />
        </a>
      </div>

      <div className="flex min-h-0 flex-1 items-start justify-center">
        <div
          style={{ width: device.w + BEZEL * 2, height: device.h + BEZEL * 2, transform: `scale(${scale})`, transformOrigin: "top center" }}
          className="rounded-[48px] bg-[#1c1715] p-3 shadow-[0_30px_80px_rgba(0,0,0,0.6)] ring-1 ring-[#2E2320]"
        >
          <iframe
            key={`${device.key}-${nonce}`}
            ref={frame}
            title="Hoppaz on a phone"
            src={src}
            width={device.w}
            height={device.h}
            className="block rounded-[38px] bg-[#0E0B0A]"
            allow="geolocation; camera"
          />
        </div>
      </div>
    </div>
  );
}
