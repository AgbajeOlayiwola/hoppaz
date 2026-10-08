"use client";

// This file replaces the root layout when the layout itself breaks, so it has to
// bring its own document, fonts, styles and theme. No router, no tab bar: plain links.
import "@fontsource/poppins/600.css";
import "@fontsource/poppins/900.css";
import "@fontsource/archivo/400.css";
import "@fontsource/archivo/500.css";
import "@fontsource/archivo/600.css";
import "@fontsource/dm-mono/400.css";
import "@fontsource/dm-mono/500.css";
import "./globals.css";
import { useEffect } from "react";
import Mascot from "@/components/Mascot";
import { useTheme } from "@/lib/useTheme";

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  // React-made scripts do not run, so the boot script cannot set the theme here: follow the clock on mount.
  useTheme();
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en" data-theme="night" suppressHydrationWarning>
      <head>
        <title>Hoppaz</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </head>
      <body>
        <div className="fixed inset-0 overflow-y-auto px-6">
          <div className="mx-auto flex min-h-full max-w-sm flex-col items-center justify-center py-10 text-center">
            <p className="seclabel">OUR SIDE · NOT YOURS</p>
            <Mascot state="oops" size={150} className="mt-3" />
            <h1 className="mt-4 text-balance font-display text-[28px] font-black leading-[1.1]">Something broke on our side.</h1>
            <div className="mt-6 flex flex-col items-center gap-3">
              {/* A plain link on purpose: with the layout down, a full page load is the safe way home. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/" className="btn">
                BACK TO TODAY
              </a>
              <button type="button" onClick={() => retry()} className="btn btn-ghost">
                TRY AGAIN
              </button>
            </div>
            {error.digest && <p className="mt-6 font-mono text-[10px] tracking-[0.1em] text-dim">REF {error.digest}</p>}
          </div>
        </div>
      </body>
    </html>
  );
}
