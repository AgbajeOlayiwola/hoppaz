"use client";

import { useState } from "react";
import { Crosshair } from "lucide-react";
import Sheet from "./Sheet";
import { AREAS, nearestArea } from "@/lib/geo";
import { useHoppaz, useToast } from "@/lib/store";

/** How far a Hopper will go. Plain choices, in kilometres: setRadius takes any number. */
const REACH: Array<{ km: number; name: string; unit: string }> = [
  { km: 3, name: "Walkable", unit: "3 km" },
  { km: 8, name: "My side", unit: "8 km" },
  { km: 20, name: "Across the bridge", unit: "20 km" },
  { km: 60, name: "All Lagos", unit: "" },
];

/**
 * The location sheet: where you are, how to set it, and (on the map) how far
 * you will go. Radius and "You are in" used to be two panels stacked on the
 * map; they live here now.
 */
export default function AreaPicker({
  open,
  onClose,
  onPicked,
  showRadius = false,
}: {
  open: boolean;
  onClose: () => void;
  onPicked?: (area: string | null) => void;
  /** The map turns this on. Other screens only want the where-are-you part. */
  showRadius?: boolean;
}) {
  const { fix, setFix, radiusKm, setRadius } = useHoppaz();
  const say = useToast((s) => s.say);
  const [locating, setLocating] = useState(false);

  const useGps = () => {
    if (!("geolocation" in navigator)) {
      say("This browser won't share your location.", "error");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const { latitude: lat, longitude: lng } = pos.coords;
        const near = nearestArea(lat, lng);
        setFix({ lat, lng, source: "gps", area: near.name });
        onPicked?.(near.name);
        say(`Locked on. ${near.name}.`, "ok");
        onClose();
      },
      () => {
        setLocating(false);
        say("Location is off. Pick your area below.", "error");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  };

  // A radius left over from the old slider (say 12 km) lights the nearest choice.
  const reach = REACH.reduce((best, r) => (Math.abs(r.km - radiusKm) < Math.abs(best.km - radiusKm) ? r : best), REACH[0]);

  return (
    <Sheet open={open} onClose={onClose} label="Set your location">
      <p className="seclabel">You are in</p>
      <p className="mt-1 font-display text-xl font-black">{fix?.area ?? "Nowhere yet"}</p>

      <button className="btn mt-3 w-full" onClick={useGps} disabled={locating}>
        <Crosshair size={15} aria-hidden />
        {locating ? "Finding you…" : "Use my location"}
      </button>
      <p className="hint mt-2">
        Location on: the map works off where you really are. Location off: pick your area and it
        works from the centre of it.
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {AREAS.map((a) => (
          <button
            key={a.name}
            aria-pressed={fix?.area === a.name}
            onClick={() => {
              setFix({ lat: a.lat, lng: a.lng, source: "area", area: a.name });
              onPicked?.(a.name);
              onClose();
            }}
            className="chip"
          >
            {a.name}
          </button>
        ))}
      </div>

      {showRadius && (
        <>
          <p className="seclabel mt-5">How far you&apos;ll go</p>
          <div className="mt-2 flex flex-col gap-1.5">
            {REACH.map((r) => (
              <button
                key={r.km}
                aria-pressed={reach.km === r.km}
                aria-label={`${r.name} ${r.unit}`.trim()}
                onClick={() => setRadius(r.km)}
                className="chip w-full justify-between"
              >
                <span>{r.name}</span>
                <span>{r.unit}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}
