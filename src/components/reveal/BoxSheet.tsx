"use client";

import { useState } from "react";
import { Camera, Footprints, Lock, MapPin, Navigation, QrCode } from "lucide-react";
import Sheet from "@/components/Sheet";
import QrScanner from "@/components/QrScanner";
import { haversineKm } from "@/lib/geo";
import { useHoppaz } from "@/lib/store";
import { huntItem, RARITY } from "@/lib/huntItems";
import { dropsLeft, type GameDrop } from "@/lib/game";
import { dropPhase, opensLabel, timeLeft } from "@/components/me/dropTime";

/** Development only: a play-test button that walks you to the box. A production build drops it. */
const IS_DEV = process.env.NODE_ENV !== "production";

/**
 * What a box on the map says when you tap it. Open and close enough: open it
 * (the reveal) or, for a hunt, find it with the camera. Open but far: how far,
 * and directions. Sealed: when it opens. It also links to its event. A street
 * box says how many are left and how long it has; a welcome box says it is yours.
 */
export default function BoxSheet({
  drop,
  at,
  fix,
  now,
  eventTitle,
  onEvent,
  onOpen,
  onHunt,
  onClose,
}: {
  drop: GameDrop;
  /** Where the box stands. */
  at: { lat: number; lng: number };
  fix: { lat: number; lng: number } | null;
  now: number;
  eventTitle?: string | null;
  onEvent?: () => void;
  /** Start the reveal, with the venue code when the drop asks for one. */
  onOpen: (code: string) => void;
  onHunt: () => void;
  onClose: () => void;
}) {
  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const sealed = dropPhase(drop, now) === "sealed";
  const item = huntItem(drop.hunt_item);
  const metres = fix ? Math.round(haversineKm(fix.lat, fix.lng, at.lat, at.lng) * 1000) : null;
  const near = metres !== null && metres <= drop.radius_m;
  const far = metres === null ? "Set your location to open it." : metres < 1000 ? `${metres} m away` : `${(metres / 1000).toFixed(1)} km away`;
  const needsCode = drop.claim_method === "qr";
  const street = drop.kind === "spawn";
  const welcome = drop.kind === "welcome";
  const left = dropsLeft(drop);
  const status = street
    ? [left !== null ? `${left} of ${drop.max_claims} left` : null, `gone in ${timeLeft(drop.closes_at, now)}`].filter(Boolean).join(" · ")
    : welcome
      ? `Yours for ${timeLeft(drop.closes_at, now)}`
      : null;
  const head = street ? ["STREET BOX", drop.area].filter(Boolean).join(" · ") : welcome ? "WELCOME BOX" : drop.partner?.name ?? "HOPPAZ DROP";
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${at.lat},${at.lng}`;
  // On a laptop every box is kilometres away: this moves you onto it so the open and hunt paths can be tried.
  const standHere = () => {
    const { fix: here, setFix } = useHoppaz.getState();
    // "area", not "gps": a play-test position is a guess. In production that keeps it from spending the one-time welcome boxes.
    // In development useWelcomeBoxes accepts an area fix too, so on a Hopper who has not had them yet this does spend them here.
    setFix({ lat: at.lat, lng: at.lng, source: "area", area: drop.area ?? here?.area ?? null });
  };

  return (
    <Sheet open onClose={onClose} label={drop.title}>
      <p className="seclabel flex items-center gap-2">
        <i aria-hidden className="h-2 w-2 flex-none rounded-full bg-violet" />
        <span className="truncate">{head}</span>
        {item && (
          <span className="ml-auto flex-none font-mono text-[10px] tracking-[0.12em]" style={{ color: RARITY[item.rarity].color }}>
            {RARITY[item.rarity].label} HUNT
          </span>
        )}
      </p>
      <h2 className="mt-2 font-display text-[24px] font-black leading-tight">{item ? `${item.name} is hiding here` : drop.title}</h2>
      {drop.description && <p className="hint mt-1">{drop.description}</p>}
      {status && <p className="mt-3 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-cream">{status}</p>}

      {eventTitle && onEvent && (
        <button type="button" onClick={onEvent} className="mt-3 flex min-h-[44px] items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-cream underline decoration-orange decoration-2 underline-offset-4">
          <MapPin size={14} aria-hidden /> AT {eventTitle.replace(/^LEAD · /, "")}
        </button>
      )}

      <div className="mt-4 border-t border-dashed border-line pt-4">
        {sealed ? (
          <>
            <button type="button" disabled className="btn w-full border border-line">
              <Lock size={15} aria-hidden /> {opensLabel(drop.opens_at, now)}
            </button>
            <p className="hint mt-2">Sealed until then. Be within {drop.radius_m} m of it when it opens.</p>
          </>
        ) : near ? (
          <>
            {needsCode && !item && (
              <div className="mb-2 flex gap-2">
                <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Venue code" aria-label="Venue code" autoCapitalize="characters" />
                <button type="button" className="btn btn-ghost w-11 flex-none px-0" onClick={() => setScanning(true)} aria-label="Scan the venue code">
                  <QrCode size={18} />
                </button>
              </div>
            )}
            {item ? (
              <button type="button" className="btn w-full" onClick={onHunt}>
                <Camera size={16} aria-hidden /> FIND IT WITH YOUR CAMERA
              </button>
            ) : (
              <button type="button" className="btn w-full" disabled={needsCode && !code.trim()} onClick={() => onOpen(code.trim())}>
                OPEN THE BOX
              </button>
            )}
          </>
        ) : (
          <>
            <p className="font-body text-[14px] leading-snug text-cream">
              {metres === null ? far : `You're ${far}. Get within ${drop.radius_m} m to open it.`}
            </p>
            <a href={directions} target="_blank" rel="noreferrer noopener" className="btn btn-ghost mt-3 w-full">
              <Navigation size={15} aria-hidden /> DIRECTIONS
            </a>
            {IS_DEV && (
              <button
                type="button"
                onClick={standHere}
                className="mt-2 flex min-h-[44px] w-full items-center justify-center gap-2 border border-dashed border-dim font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-dim hover:text-cream"
              >
                <Footprints size={14} aria-hidden /> DEV: STAND HERE
              </button>
            )}
          </>
        )}
      </div>

      {scanning && (
        <QrScanner
          onRead={(value) => {
            setCode(value);
            setScanning(false);
          }}
          onClose={() => setScanning(false)}
        />
      )}
    </Sheet>
  );
}
