"use client";

import { useEffect, useState } from "react";
import HotspotsSection, { emptyHotspots } from "@/components/admin/HotspotsSection";
import type { HotspotsAdmin } from "@/app/api/admin/game/hotspots";

type Hooks = { __hzAdmin?: { set: (d: HotspotsAdmin) => void }; __acts?: Record<string, unknown>[] };

/** The admin page's frame around the Hotspots section, fed by a script and sending nothing. */
export default function DevHotspotAdmin() {
  const [data, setData] = useState<HotspotsAdmin>(emptyHotspots);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const w = window as unknown as Hooks;
    w.__acts = [];
    w.__hzAdmin = {
      set: (d) => {
        setData(d);
        setLoaded(true);
      },
    };
  }, []);

  const act = async (body: Record<string, unknown>) => {
    (window as unknown as Hooks).__acts?.push(body);
    return { ok: true };
  };

  return (
    <div className="h-full overflow-y-auto px-4 pb-6">
      <header className="pad-top pb-4">
        <h1 className="font-display text-2xl font-black">Launch desk</h1>
        <p className="seclabel mt-1.5">Hotspots only · nothing is sent from here</p>
      </header>
      <HotspotsSection hotspots={data} act={act} busy={false} loading={!loaded} />
    </div>
  );
}
