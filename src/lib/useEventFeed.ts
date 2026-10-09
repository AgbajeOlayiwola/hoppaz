"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "./supabase/client";
import { shrink } from "./image";
import type { EventPhoto } from "./types";

const BUCKET = "event-photos";

/** What the Hopper is told after trying to post a photo. */
export type UploadResult = { ok: boolean; message: string };

/**
 * What the event page shows from the night: approved photos only (the read
 * policy hides anything still in review). The page no longer previews chat;
 * the room has its own screen.
 */
export function useEventFeed(eventId: string | null, userId: string | null) {
  const [photos, setPhotos] = useState<EventPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    const sb = getSupabase();
    setPhotos([]);
    if (!sb || !eventId || eventId.startsWith("demo-")) return;
    setLoading(true);
    const p = await sb.from("event_photos").select("*").eq("event_id", eventId).order("created_at", { ascending: false }).limit(30);
    setLoading(false);
    const photoRows = (p.data ?? []) as Omit<EventPhoto, "url">[];
    const signed = await Promise.all(
      photoRows.map(async (r) => {
        const { data } = await sb.storage.from(BUCKET).createSignedUrl(r.path, 60 * 60);
        return { ...r, url: data?.signedUrl ?? "" };
      })
    );
    setPhotos(signed.filter((r) => r.url));
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Posts a photo. Photos go to review first, so success says "sent", not "posted". */
  const upload = useCallback(
    async (file: File): Promise<UploadResult> => {
      const sb = getSupabase();
      if (!sb || !userId || !eventId) return { ok: false, message: "Can't send photos right now." };
      setUploading(true);
      try {
        const blob = await shrink(file);
        const path = `${userId}/${eventId}/${crypto.randomUUID()}.jpg`;
        const up = await sb.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg" });
        if (up.error) return { ok: false, message: "That photo didn't go up. Try again." };
        const row = await sb.from("event_photos").insert({ event_id: eventId, user_id: userId, path });
        if (row.error) {
          // The insert policy refused it (not checked in): do not leave an orphan file.
          await sb.storage.from(BUCKET).remove([path]);
          return { ok: false, message: "Check in first, then post." };
        }
        await load();
        return { ok: true, message: "Photo sent. It shows once it's checked." };
      } catch {
        return { ok: false, message: "Couldn't read that photo." };
      } finally {
        setUploading(false);
      }
    },
    [eventId, userId, load]
  );

  return { photos, loading, uploading, upload };
}
