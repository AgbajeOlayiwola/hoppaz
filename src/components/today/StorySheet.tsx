"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Share2, X } from "lucide-react";
import { demoFlyer } from "@/components/event/demo";
import { shareEvent } from "@/components/event/share";
import { eventTitle } from "@/lib/geo";
import { useToast } from "@/lib/store";
import type { EventRow } from "@/lib/types";
import { loadPalette } from "./palette";
import { renderStory } from "./story";
import m from "./today.module.css";

type Made = { url: string; file: File; usedFlyer: boolean };

/** The page for an event, on this site. It is what the share sheet sends along with the picture (the picture itself only prints the site's address). */
const eventLink = (id: string) => `${window.location.origin}/event/${encodeURIComponent(id)}`;

/**
 * SHARE TO STORY: draws the 9:16 picture for the event and shows it in a sheet.
 * Save image downloads the PNG; where the phone's share sheet can take a file
 * (navigator.canShare with files) a SHARE button hands it the picture itself, so
 * it lands in Instagram or TikTok ready to post. SHARE LINK is the plain link to
 * the event, through the app's usual share.
 */
export default function StorySheet({
  event,
  going,
  box,
  onClose,
}: {
  /** The event to make the story for. Null: the sheet is shut. */
  event: EventRow | null;
  going: number;
  box: boolean;
  onClose: () => void;
}) {
  const say = useToast((s) => s.say);
  const [made, setMade] = useState<Made | null>(null);
  const [failed, setFailed] = useState(false);
  const [canFile, setCanFile] = useState(false);
  const close = useRef<HTMLButtonElement>(null);
  // The numbers can move while the sheet is open; the picture is made once, from the first ones.
  const live = useRef({ going, box });
  useEffect(() => {
    live.current = { going, box };
  });

  const id = event?.id ?? null;
  useEffect(() => {
    if (!event) return;
    let dead = false;
    let url = "";
    setMade(null);
    setFailed(false);
    const flyer = demoFlyer(event);
    (async () => {
      const palette = await loadPalette(flyer);
      const { blob, usedFlyer } = await renderStory({
        event,
        going: live.current.going,
        flyer,
        palette,
        box: live.current.box,
        link: window.location.host,
        now: Date.now(),
      });
      if (dead) return;
      url = URL.createObjectURL(blob);
      const file = new File([blob], `hoppaz-${slug(eventTitle(event))}-story.png`, { type: "image/png" });
      setCanFile(typeof navigator !== "undefined" && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] }));
      setMade({ url, file, usedFlyer });
    })().catch(() => {
      if (!dead) setFailed(true);
    });
    return () => {
      dead = true;
      if (url) URL.revokeObjectURL(url);
    };
    // The picture belongs to one event: a re-render with a fresh copy of the same event must not redraw it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    close.current?.focus({ preventScroll: true });
    return () => window.removeEventListener("keydown", onKey);
  }, [id, onClose]);

  if (!event) return null;
  const title = eventTitle(event);

  const share = async () => {
    if (!made) return;
    try {
      await navigator.share({ files: [made.file], title, text: `${title} on Hoppaz`, url: eventLink(event.id) });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) say("Could not open the share sheet. Save the image instead.", "error");
    }
  };
  const link = async () => {
    const res = await shareEvent(event, going);
    if (res === "copied") say("Link copied.", "ok");
    else if (res === "failed") say("Could not copy the link.", "error");
  };

  return (
    <div className="absolute inset-0 z-[45]">
      <button type="button" aria-label="Close" tabIndex={-1} onClick={onClose} className="absolute inset-0 animate-fade bg-brand-ink/65" />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Share to story"
        className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[96%] w-full max-w-[460px] animate-rise flex-col overflow-hidden rounded-t-[26px] border-t border-line bg-ink-2 text-cream shadow-sheet"
      >
        <span aria-hidden className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-line" />
        <button
          ref={close}
          type="button"
          onClick={onClose}
          aria-label="Close story preview"
          className="absolute right-2 top-2 z-10 grid h-11 w-11 place-items-center text-dim hover:text-cream"
        >
          <X size={18} />
        </button>

        <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-5 pb-5 pt-9">
          <div className="self-start">
            <h2 className="font-display text-[22px] font-black leading-none tracking-[-0.02em]">Share to story</h2>
            <p className="mt-1.5 font-body text-[13px] text-dim">9:16, ready for Instagram and TikTok.</p>
          </div>

          <div className={`${m.stage} mt-4`}>
            {made ? (
              // eslint-disable-next-line @next/next/no-img-element -- a blob URL made a moment ago
              <img src={made.url} alt={`The story picture for ${title}`} />
            ) : (
              <div role="status" className={m.stageLd}>
                {failed ? "COULD NOT DRAW IT. CLOSE AND TRY AGAIN." : "DRAWING YOUR STORY"}
              </div>
            )}
          </div>

          <div className="mt-4 flex w-full flex-col gap-2">
            {canFile && (
              <button type="button" onClick={() => void share()} disabled={!made} className="btn w-full">
                <Share2 size={16} strokeWidth={2.6} aria-hidden /> SHARE TO STORY
              </button>
            )}
            <div className="flex gap-2">
              {made ? (
                <a
                  href={made.url}
                  download={made.file.name}
                  onClick={() => say("Saving your story image.", "ok")}
                  className={`btn flex-1 ${canFile ? "btn-ghost" : ""}`}
                >
                  <Download size={16} strokeWidth={2.6} aria-hidden /> SAVE IMAGE
                </a>
              ) : (
                <span aria-disabled="true" className="btn flex-1 pointer-events-none opacity-50">
                  <Download size={16} strokeWidth={2.6} aria-hidden /> SAVE IMAGE
                </span>
              )}
              <button type="button" onClick={() => void link()} className="btn btn-ghost flex-1">
                SHARE LINK
              </button>
            </div>
          </div>
          <p className="mt-3 text-center font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-dim">
            {made
              ? `${made.usedFlyer || !demoFlyer(event) ? "" : "Flyer left off: its host blocks copies. "}1080 x 1920 PNG`
              : "1080 x 1920 PNG"}
          </p>
        </div>
      </section>
    </div>
  );
}

const slug = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "event";
