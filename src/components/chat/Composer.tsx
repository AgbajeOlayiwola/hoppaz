"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { ImagePlus, X } from "lucide-react";

/**
 * The message box for rooms and DMs: text, an optional picture, send.
 * onSend returns an error line (shown by the caller) or null when sent.
 * `safeArea` pads for the phone's home bar: leave it on where no tab bar sits
 * underneath (a private chat), turn it off where one does (the tab bar pads itself).
 */
export default function Composer({
  placeholder,
  maxLength,
  onSend,
  safeArea = true,
  images = true,
}: {
  placeholder: string;
  maxLength: number;
  onSend: (body: string, image: File | null) => Promise<string | null>;
  safeArea?: boolean;
  /** False for a text-only room (a hotspot): no picture button. */
  images?: boolean;
}) {
  const [body, setBody] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!image) return setPreview(null);
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = body.trim();
    if ((!text && !image) || sending) return;
    setSending(true);
    const error = await onSend(text, image);
    setSending(false);
    if (!error) {
      setBody("");
      setImage(null);
    }
  };

  return (
    <form onSubmit={submit} className={clsx("flex flex-none flex-col gap-2 border-t border-line pt-2.5", safeArea ? "pad-bottom" : "pb-3")}>
      {preview && (
        <div className="relative w-fit">
          {/* eslint-disable-next-line @next/next/no-img-element -- local preview blob */}
          <img src={preview} alt="Picture to send" className="h-20 rounded-hz border border-line object-cover" />
          <button
            type="button"
            onClick={() => setImage(null)}
            aria-label="Remove picture"
            className="absolute -right-3 -top-3 grid h-8 w-8 place-items-center rounded-full border border-line bg-ink-2 text-cream"
          >
            <X size={14} />
          </button>
        </div>
      )}
      <div className="flex items-end gap-2">
        {images && (
          <>
            <button
              type="button"
              onClick={() => file.current?.click()}
              aria-label="Add a picture"
              className="btn btn-ghost w-11 flex-none px-0"
            >
              <ImagePlus size={17} />
            </button>
            <input
              ref={file}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                setImage(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
          </>
        )}
        <input value={body} onChange={(e) => setBody(e.target.value)} placeholder={placeholder} maxLength={maxLength} autoComplete="off" aria-label="Message" className="min-h-[44px]" />
        <button type="submit" className="btn flex-none px-4" disabled={sending || (!body.trim() && !image)}>
          {sending ? "..." : "SEND"}
        </button>
      </div>
    </form>
  );
}
