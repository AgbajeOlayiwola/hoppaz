"use client";

import { useToast } from "@/lib/store";

/**
 * A voucher code printed like the serial on a ticket: DM Mono, spaced out,
 * with a COPY lip button. Select-all stays on so a long press still works if
 * the clipboard is blocked.
 */
export default function Serial({ code, label = "CODE" }: { code: string; label?: string }) {
  const say = useToast((s) => s.say);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      say("Code copied.", "ok");
    } catch {
      say("Couldn't copy. Hold the code to copy it.", "error");
    }
  };
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="seclabel">{label}</p>
        <p className="mt-0.5 select-all overflow-x-auto whitespace-nowrap font-mono text-[16px] font-medium tracking-[0.14em] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {code}
        </p>
      </div>
      <button type="button" onClick={copy} className="btn flex-none px-4 py-2 text-[12px]">
        COPY
      </button>
    </div>
  );
}
