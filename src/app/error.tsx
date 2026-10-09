"use client";

import Link from "next/link";
import { useEffect } from "react";
import Mascot from "@/components/Mascot";

/**
 * A crash inside a page. Next 16 hands us `retry`: it re-fetches and re-renders
 * the segment, which is what a Hopper means by "try again". The root layout
 * (and the tab bar) is still standing around this.
 */
export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="h-full overflow-y-auto px-6">
      <div className="mx-auto flex min-h-full max-w-sm flex-col items-center justify-center py-10 text-center">
        <p className="seclabel">OUR SIDE · NOT YOURS</p>
        <Mascot state="oops" size={150} className="mt-3" />
        <h1 className="mt-4 text-balance font-display text-[28px] font-black leading-[1.1]">Something broke on our side.</h1>
        <div className="mt-6 flex flex-col items-center gap-3">
          <Link href="/" className="btn">
            BACK TO TODAY
          </Link>
          <button type="button" onClick={() => retry()} className="btn btn-ghost">
            TRY AGAIN
          </button>
        </div>
        {error.digest && <p className="mt-6 font-mono text-[10px] tracking-[0.1em] text-dim">REF {error.digest}</p>}
      </div>
    </div>
  );
}
