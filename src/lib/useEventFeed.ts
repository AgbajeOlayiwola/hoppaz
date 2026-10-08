"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "./supabase/client";
import { shrink } from "./image";
import type { EventPhoto, Message } from "./types";

const BUCKET = "event-photos";

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
    const photoRows = (p.data ?? []) as Omit<EventPhoto, "url">[];
    const signed = await Promise.all(photoRows.map(async (r) => {
      const { data } = await sb.storage.from(BUCKET).createSignedUrl(r.path, 60 * 60);
      return { ...r, url: data?.signedUrl ?? "" };
    }));
    setPhotos(signed.filter((r) => r.url));
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
        return "PHOTO SUBMITTED · PENDING REVIEW";
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
