"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Compass, LocateFixed, X } from "lucide-react";
import type { GameDrop } from "@/lib/game";
import Hunt3D from "@/components/Hunt3D";
import { huntItem, RARITY } from "@/lib/huntItems";

type Point = { lat: number; lng: number };
type ClaimResult = { error?: string; reward?: string; description?: string; code?: string };

function pointFromGeog(value: unknown, fallback: Point): Point {
  if (value && typeof value === "object" && "coordinates" in value) {
    const coordinates = (value as { coordinates?: unknown }).coordinates;
    if (Array.isArray(coordinates) && coordinates.length >= 2) {
      const [lng, lat] = coordinates.map(Number);
      if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    }
  }
  if (typeof value === "string") {
    const match = value.match(/POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/i);
    if (match) return { lng: Number(match[1]), lat: Number(match[2]) };
  }
  return fallback;
}

function distanceMeters(a: Point, b: Point) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(h));
}

function bearingDegrees(a: Point, b: Point) {
  const rad = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * rad) * Math.cos(b.lat * rad);
  const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lng - a.lng) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

function targetPoint(origin: Point, id: string, radius: number): Point {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const bearing = (hash % 360) * Math.PI / 180;
  const distance = Math.min(32, Math.max(8, radius * 0.22));
  const dLat = distance * Math.cos(bearing) / 111320;
  const dLng = distance * Math.sin(bearing) / (111320 * Math.cos(origin.lat * Math.PI / 180));
  return { lat: origin.lat + dLat, lng: origin.lng + dLng };
}

function targetEmoji(id: string) {
  const creatures = ["🦊", "🐉", "🦋", "🐢", "🦁", "🐙", "🦄", "🐝"];
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return creatures[hash % creatures.length];
}

export default function CameraHunt({
  drop,
  eventPoint,
  initialFix,
  onClaim,
  onClose,
}: {
  drop: GameDrop;
  eventPoint: Point;
  initialFix: Point | null;
  onClaim: (fix: Point) => Promise<ClaimResult>;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [started, setStarted] = useState(false);
  const [heading, setHeading] = useState<number | null>(null);
  const [fix, setFix] = useState<Point | null>(initialFix);
  const [error, setError] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [found, setFound] = useState(false);
  const dropPoint = useMemo(() => pointFromGeog(drop.geog, eventPoint), [drop.geog, eventPoint]);
  const spot = useMemo(() => targetPoint(dropPoint, drop.id, drop.radius_m), [dropPoint, drop.id, drop.radius_m]);
  const distance = fix ? distanceMeters(fix, dropPoint) : null;
  const targetBearing = fix ? bearingDegrees(fix, spot) : null;
  const turn = targetBearing !== null && heading !== null ? ((targetBearing - heading + 540) % 360) - 180 : null;
  const aligned = turn !== null && Math.abs(turn) <= 10;
  const inRange = distance !== null && distance <= drop.radius_m;
  const canCatch = started && aligned && inRange && !!fix && !claiming;
  const left = turn === null ? 50 : Math.max(6, Math.min(94, 50 + turn * 1.8));
  // A 3D collectible when the drop has one, the old emoji target otherwise.
  const item = huntItem(drop.hunt_item);
  const target = (cls: string) =>
    item ? <Hunt3D item={item.key} spin={aligned ? 1.6 : 0.6} className={cls} /> : <span className="grid h-full w-full place-items-center text-4xl">{targetEmoji(drop.id)}</span>;

  useEffect(() => {
    if (!started) return;
    let watchId: number | null = null;
    const updateHeading = (event: Event) => {
      const e = event as DeviceOrientationEvent & { webkitCompassHeading?: number };
      const value = typeof e.webkitCompassHeading === "number"
        ? e.webkitCompassHeading
        : e.absolute && typeof e.alpha === "number"
          ? (360 - e.alpha + 360) % 360
          : null;
      if (value !== null) setHeading(value);
    };
    window.addEventListener("deviceorientation", updateHeading);
    window.addEventListener("deviceorientationabsolute", updateHeading);
    if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        (position) => setFix({ lat: position.coords.latitude, lng: position.coords.longitude }),
        () => setError("Allow location access so Hoppaz can verify you are at the event."),
        { enableHighAccuracy: true, maximumAge: 1500, timeout: 15000 },
      );
    } else setError("This browser does not provide location access.");
    return () => {
      window.removeEventListener("deviceorientation", updateHeading);
      window.removeEventListener("deviceorientationabsolute", updateHeading);
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    };
  }, [started]);

  useEffect(() => () => stream.current?.getTracks().forEach((track) => track.stop()), []);

  const start = async () => {
    setError("");
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError("Camera hunts need a secure HTTPS connection and a supported mobile browser.");
      return;
    }
    try {
      const Orientation = window.DeviceOrientationEvent as typeof DeviceOrientationEvent & { requestPermission?: (absolute?: boolean) => Promise<PermissionState> };
      if (typeof Orientation?.requestPermission === "function") {
        const permission = await Orientation.requestPermission(true);
        if (permission !== "granted") {
          setError("Allow compass access to find the target in camera mode.");
          return;
        }
      }
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      stream.current = media;
      if (video.current) {
        video.current.srcObject = media;
        await video.current.play();
      }
      setStarted(true);
    } catch {
      setError("Camera or compass access was blocked. Allow both permissions and try again.");
    }
  };

  const catchTarget = async () => {
    if (!fix || !canCatch) return;
    setClaiming(true);
    const result = await onClaim(fix);
    setClaiming(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setFound(true);
  };

  return (
    <div className="fixed inset-0 z-[80] overflow-hidden bg-black text-white" role="dialog" aria-modal="true" aria-label="Camera reward hunt">
      <video ref={video} playsInline muted className="absolute inset-0 h-full w-full object-cover" />
      {!started && <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/30 to-black/90" />}
      <div className="absolute inset-0 bg-black/20" />

      <header className="pad-top absolute inset-x-0 top-0 z-10 flex items-center justify-between px-4">
        <div><p className="font-mono text-[9px] font-bold tracking-[0.2em] text-orange">HOPPAZ CAMERA HUNT</p><p className="mt-1 text-xs text-white/80">{drop.title}</p></div>
        <button onClick={onClose} aria-label="Close camera hunt" className="grid h-10 w-10 place-items-center rounded-full border border-white/30 bg-black/50"><X size={18}/></button>
      </header>

      {started && !found && (
        <>
          <div className="absolute left-1/2 top-1/2 z-10 h-44 w-44 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/25" />
          <div className="absolute left-1/2 top-1/2 z-10 h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full border border-orange/70" />
          <div className="absolute inset-x-4 top-[42%] z-20 flex justify-center" style={{ left: `${left}%`, right: "auto", transform: "translateX(-50%)" }}>
            {item
              ? <div className={`relative h-40 w-40 transition-transform duration-300 ${aligned ? "scale-125" : "scale-90 opacity-80"}`} aria-label={`${item.name}, hidden here`}>
                  <span aria-hidden className="absolute inset-6 rounded-full blur-2xl" style={{ background: RARITY[item.rarity].color, opacity: aligned ? 0.7 : 0.35 }} />
                  {target("relative h-full w-full")}
                </div>
              : <div className={`grid h-16 w-16 place-items-center rounded-2xl border-2 border-orange bg-black/65 shadow-[0_0_38px_rgba(255,77,0,0.8)] transition-transform ${aligned ? "scale-125" : ""}`} aria-label="Digital reward target">{target("")}</div>}
          </div>
          <div className="absolute inset-x-4 bottom-24 z-20 rounded-xl border border-white/20 bg-black/70 p-4 text-center backdrop-blur">
            <p className="flex items-center justify-center gap-2 font-mono text-[10px] font-bold tracking-widest text-orange"><Compass size={14}/>{heading === null ? "SEARCHING FOR COMPASS" : aligned ? "TARGET LOCKED" : `${Math.round(Math.abs(turn ?? 0))}° ${turn !== null && turn > 0 ? "RIGHT" : "LEFT"}`}</p>
            <p className="mt-2 font-display text-sm font-black">{!fix ? "FINDING YOUR LOCATION…" : !inRange ? `${Math.round(distance ?? 0)}M AWAY · MOVE CLOSER` : aligned ? "YOU FOUND IT" : "TURN YOUR PHONE TO FIND IT"}</p>
            <p className="hint mt-1 text-white/60">{Math.round(distance ?? 0)}m from drop · within {drop.radius_m}m to claim</p>
            {heading === null && <p className="hint mt-2 text-orange">This phone/browser is not sharing compass direction. Allow motion access or use the venue QR.</p>}
            {error && <p role="alert" className="mt-2 text-xs text-orange">{error}</p>}
            <button className="btn mt-3 w-full" disabled={!canCatch} onClick={() => void catchTarget()}>{claiming ? "CLAIMING…" : canCatch ? "CATCH & CLAIM REWARD" : "SEARCH THE CAMERA VIEW"}</button>
          </div>
        </>
      )}

      {!started && !found && (
        <div className="absolute inset-x-5 bottom-12 z-20 rounded-xl border border-white/20 bg-black/75 p-5 text-center backdrop-blur">
          <div className="mx-auto h-28 w-28">{item ? <Hunt3D item={item.key} locked className="h-full w-full" /> : <span className="grid h-full w-full place-items-center rounded-2xl border border-orange/60 bg-orange/10 text-5xl">{targetEmoji(drop.id)}</span>}</div>
          {item && <p className="mt-2 font-mono text-[9px] font-bold tracking-[0.16em]" style={{ color: RARITY[item.rarity].color }}>{RARITY[item.rarity].label}</p>}
          <h2 className="mt-2 font-display text-xl font-black">{item ? `Something ${item.rarity === "common" ? "tasty" : "rare"} is hiding here` : "A reward is hiding nearby"}</h2>
          <p className="hint mt-2 text-white/70">Move your phone to search the camera view. Line up the target and claim the event reward. Camera frames stay on this device.</p>
          {error && <p role="alert" className="mt-3 text-xs text-orange">{error}</p>}
          <button className="btn mt-4 w-full" onClick={() => void start()}><Camera size={15}/> START CAMERA HUNT</button>
          {!initialFix && <p className="mt-2 flex items-center justify-center gap-1 text-[9px] text-white/60"><LocateFixed size={12}/> Location permission is needed to claim.</p>}
        </div>
      )}

      {found && <div className="absolute inset-0 z-30 grid place-items-center bg-black/80 p-6 text-center"><div className="card max-w-sm border-orange/60 bg-ink-2">{item ? <div className="mx-auto h-44 w-44"><Hunt3D item={item.key} spin={1} className="h-full w-full" /></div> : <div className="text-7xl">{targetEmoji(drop.id)}</div>}<p className="seclabel mt-4" style={{ color: item ? RARITY[item.rarity].color : undefined }}>{item ? `${RARITY[item.rarity].label} · FOUND` : "TARGET FOUND"}</p><h2 className="mt-2 font-display text-2xl font-black">{item ? item.name : "Reward unlocked"}</h2><p className="hint mt-2">{item ? `${item.blurb} It's in your collection, and your reward is on the event card.` : "Your reward is ready in the event card and your collection."}</p><button className="btn mt-5 w-full" onClick={onClose}>BACK TO EVENT</button></div></div>}
    </div>
  );
}
