"use client";

import { useState } from "react";
import Sheet from "@/components/Sheet";
import { confirmAdult } from "./api";

/**
 * "I'm 18 or older", once per account. A hotspot is an open room of strangers, so it is for adults; the
 * server keeps the yes (confirm_adult) and refuses it when the birthday on the account says under 18.
 * Closing the sheet is a no: the room closes with it.
 */
export default function AdultSheet({ place, onYes, onNo }: { place: string; onYes: () => void; onNo: () => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<"under_18" | "error" | null>(null);

  const yes = async () => {
    setBusy(true);
    const r = await confirmAdult();
    setBusy(false);
    if (r.ok) return onYes();
    setProblem(r.reason === "under_18" ? "under_18" : "error");
  };

  return (
    <>
      <div className="absolute inset-0 z-[39] bg-ink/60" onClick={onNo} aria-hidden />
      <Sheet open onClose={onNo} label="Confirm your age">
        {problem === "under_18" ? (
          <>
            <h2 className="pr-10 font-display text-[22px] font-black leading-[1.1]">Hotspots are for 18 and over.</h2>
            <p className="hint mt-2">The birthday on your account says you are under 18. Events and boxes are still yours.</p>
            <button className="btn mt-4 w-full" onClick={onNo}>
              BACK TO THE MAP
            </button>
          </>
        ) : (
          <>
            <h2 className="pr-10 font-display text-[22px] font-black leading-[1.1]">Are you 18 or older?</h2>
            <p className="hint mt-2">{place} is an open room with people you do not know, so hotspots are for 18 and over. We ask once.</p>
            {problem === "error" && (
              <p role="alert" className="mt-3 font-body text-[13px] leading-snug text-fireant">
                Could not save that. Check your connection and try again.
              </p>
            )}
            <div className="mt-4 grid gap-2">
              <button className="btn w-full" onClick={yes} disabled={busy}>
                {busy ? "..." : "I'M 18 OR OLDER"}
              </button>
              <button className="btn btn-ghost w-full" onClick={onNo} disabled={busy}>
                NOT NOW
              </button>
            </div>
          </>
        )}
      </Sheet>
    </>
  );
}
