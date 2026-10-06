"use client";

import { useState } from "react";
import { Crosshair } from "lucide-react";
import clsx from "clsx";
import Sheet from "./Sheet";
import { AREAS, nearestArea } from "@/lib/geo";
import { useHoppaz, useToast } from "@/lib/store";

export default function AreaPicker({
  open,
  onClose,
  onPicked,
}: {
  open: boolean;
  onClose: () => void;
  onPicked?: (area: string | null) => void;
}) {
  const { fix, setFix } = useHoppaz();
  const say = useToast((s) => s.say);
  const [locating, setLocating] = useState(false);

  const useGps = () => {
    if (!("geolocation" in navigator)) {
      say("THIS BROWSER WILL NOT SHARE LOCATION");
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
        say(`LOCKED ON · ${near.name.toUpperCase()}`);
        onClose();
      },
      () => {
        setLocating(false);
        say("LOCATION DENIED · PICK YOUR AREA");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  };

  return (
    <Sheet open={open} onClose={onClose} label="Set your location">
      <p className="seclabel">Where are you right now</p>
      <p className="hint mb-3 mt-1">
        Turn on location and the map works off your real position. Deny it and pick your area
        instead: everything still works, just from the centre of that area.
      </p>
      <button className="btn btn-ghost mb-4 w-full" onClick={useGps} disabled={locating}>
        <Crosshair size={14} />
        {locating ? "FINDING YOU…" : "USE MY LOCATION"}
      </button>
      <div className="flex flex-wrap gap-1.5">
        {AREAS.map((a) => (
          <button
            key={a.name}
            onClick={() => {
              setFix({ lat: a.lat, lng: a.lng, source: "area", area: a.name });
              onPicked?.(a.name);
              onClose();
            }}
            className={clsx(
              "tag cursor-pointer px-2.5 py-2 text-[10px]",
              fix?.area === a.name && "tag-o"
            )}
          >
            {a.name.toUpperCase()}
          </button>
        ))}
      </div>
    </Sheet>
  );
}
