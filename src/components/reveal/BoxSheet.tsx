"use client";

import { useState } from "react";
import { Camera, Lock, MapPin, Navigation, QrCode } from "lucide-react";
import Sheet from "@/components/Sheet";
import QrScanner from "@/components/QrScanner";
import { haversineKm } from "@/lib/geo";
import { huntItem, RARITY } from "@/lib/huntItems";
import type { GameDrop } from "@/lib/game";
import { opensLabel } from "@/components/me/dropTime";

/**
 * What a box on the map says when you tap it. Open and close enough: open it
 * (the reveal) or, for a hunt, find it with the camera. Open but far: how far,
 * and directions. Sealed: when it opens. It also links to its event.
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
  const sealed = Date.parse(drop.opens_at) > now;
  const item = huntItem(drop.hunt_item);
  const metres = fix ? Math.round(haversineKm(fix.lat, fix.lng, at.lat, at.lng) * 1000) : null;
  const near = metres !== null && metres <= drop.radius_m;
  const far = metres === null ? "Set your location to open it." : metres < 1000 ? `${metres} m away` : `${(metres / 1000).toFixed(1)} km away`;
  const needsCode = drop.claim_method === "qr";
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${at.lat},${at.lng}`;

  return (
    <Sheet open onClose={onClose} label={drop.title}>
      <p className="seclabel flex items-center gap-2">
        <i aria-hidden className="h-2 w-2 flex-none rounded-full bg-violet" />
        <span className="truncate">{drop.partner?.name ?? "HOPPAZ DROP"}</span>
        {item && (
          <span className="ml-auto flex-none font-mono text-[10px] tracking-[0.12em]" style={{ color: RARITY[item.rarity].color }}>
            {RARITY[item.rarity].label} HUNT
          </span>
        )}
      </p>
      <h2 className="mt-2 font-display text-[24px] font-black leading-tight">{item ? `${item.name} is hiding here` : drop.title}</h2>
      {drop.description && <p className="hint mt-1">{drop.description}</p>}

      {eventTitle && onEvent && (
        <button type="button" onClick={onEvent} className="mt-3 flex min-h-[44px] items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-cream underline decoration-orange decoration-2 underline-offset-4">
          <MapPin size={14} aria-hidden /> AT {eventTitle.replace(/^LEAD · /, "")}
        </button>
      )}

      <div className="mt-4 border-t border-dashed border-line pt-4">
        {sealed ? (
          <button type="button" disabled className="btn w-full border border-line">
            <Lock size={15} aria-hidden /> {opensLabel(drop.opens_at, now)}
          </button>
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
