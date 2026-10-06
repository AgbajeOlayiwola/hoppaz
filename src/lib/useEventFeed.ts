"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "./supabase/client";
import type { EventPhoto, Message } from "./types";

const BUCKET = "event-photos";

/** Shrink a phone photo before it leaves the phone: Lagos data is not free. */
async function shrink(file: File, max = 1280): Promise<Blob> {
  const img = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * k);
  c.height = Math.round(img.height * k);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error("encode failed"))), "image/jpeg", 0.8));
}

/** What the event card scrolls through: photos from the night and the latest chat. */
export function useEventFeed(eventId: string | null, userId: string | null) {
  const [photos, setPhotos] = useState<EventPhoto[]>([]);
  const [chat, setChat] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    const sb = getSupabase();
    setPhotos([]);
    setChat([]);
    if (!sb || !eventId || eventId.startsWith("demo-")) return;
    setLoading(true);
    const [p, m] = await Promise.all([
      sb.from("event_photos").select("*").eq("event_id", eventId).order("created_at", { ascending: false }).limit(30),
      sb
        .from("messages")
        .select("id, channel, body, created_at, author_key, author_name, author_look, anon")
        .eq("channel", eventId)
        .order("created_at", { ascending: false })
        .limit(6),
    ]);
    setLoading(false);
    setPhotos(
      ((p.data ?? []) as Omit<EventPhoto, "url">[]).map((r) => ({
        ...r,
        url: sb.storage.from(BUCKET).getPublicUrl(r.path).data.publicUrl,
      }))
    );
    setChat((m.data ?? []) as Message[]);
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Returns an error line for the toast, or null on success. */
  const upload = useCallback(
    async (file: File): Promise<string | null> => {
      const sb = getSupabase();
      if (!sb || !userId || !eventId) return "NOT CONNECTED, PHOTO NOT SAVED";
      setUploading(true);
      try {
        const blob = await shrink(file);
        const path = `${userId}/${eventId}/${crypto.randomUUID()}.jpg`;
        const up = await sb.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg" });
        if (up.error) return "UPLOAD FAILED";
        const row = await sb.from("event_photos").insert({ event_id: eventId, user_id: userId, path });
        if (row.error) {
          // The insert policy refused it (not checked in): do not leave an orphan file.
          await sb.storage.from(BUCKET).remove([path]);
          return "CHECK IN FIRST TO POST PHOTOS";
        }
        await load();
        return null;
      } catch {
        return "COULD NOT READ THAT PHOTO";
      } finally {
        setUploading(false);
      }
    },
    [eventId, userId, load]
  );

  return { photos, chat, loading, uploading, upload };
}
