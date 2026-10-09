"use client";

import { useEffect, useRef } from "react";
import { onOpenEvent } from "@/components/play/open/events";
import { useGeoPermission, useLivePosition } from "@/lib/useLivePosition";
import { onPlayEvent } from "@/lib/usePlayMode";
import { introEvent, introSetOpening, useIntro } from "./store";

/**
 * The events the app already emits, turned into tour events, so the wiring
 * step has less to do. Mounted once by IntroHost:
 *
 *   Play shell   enter, exit, first-box-opened, welcome-done  (usePlayMode)
 *   Open moment  open-start .. open-done                      (play/open/events)
 *   Location     the permission and the live position         (useLivePosition)
 *   Install      the browser's appinstalled event
 *
 * Not bridged (no existing signal): map_ready, deck_viewed, event_opened,
 * chat_opened, crew_viewed, me_viewed. docs/INTRO.md lists the one line each.
 */
export function useIntroBridges(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const offPlay = onPlayEvent((e) => {
      if (e.type === "enter") introEvent("play_entered");
      else if (e.type === "exit") introEvent("play_exited");
      else if (e.type === "welcome-done") introEvent("welcome_done");
    });
    // One box_opened per finished open. (first-box-opened fires once per device, so it is not used.)
    const offOpen = onOpenEvent((e) => {
      if (e.type === "open-start") introSetOpening(true);
      else if (e.type === "open-cancel") window.setTimeout(() => introSetOpening(false), 400);
      else if (e.type === "open-done") {
        if (e.result.ok) introEvent("box_opened");
        window.setTimeout(() => introSetOpening(false), 700);
      }
    });
    const onInstalled = () => introEvent("install_done");
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      offPlay();
      offOpen();
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [enabled]);

  // Location. The permission is read without asking; the watch only runs after the locate button.
  const permission = useGeoPermission();
  const wantLocate = useIntro((s) => s.wantLocate);
  const { pos, status } = useLivePosition({ enabled: enabled && wantLocate });

  useEffect(() => {
    if (!enabled) return;
    if (permission === "denied") introEvent("location_denied");
  }, [enabled, permission]);

  useEffect(() => {
    if (!enabled) return;
    if (status === "denied") introEvent("location_denied");
  }, [enabled, status]);

  // The first reading says whether the Hopper is in Lagos; later ones change nothing, so they are not sent.
  const sent = useRef(false);
  useEffect(() => {
    if (!enabled || !pos || sent.current) return;
    sent.current = true;
    introEvent("location_granted", { lat: pos.lat, lng: pos.lng });
  }, [enabled, pos]);

  useEffect(() => {
    if (!enabled) return;
    if (permission === "granted") introEvent("location_granted");
  }, [enabled, permission]);
}
