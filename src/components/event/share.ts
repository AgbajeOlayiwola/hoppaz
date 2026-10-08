import { nightOf } from "@/lib/filters";
import { clockShort, eventPrice, eventTitle, isEventLead } from "@/lib/geo";
import type { EventRow } from "@/lib/types";

/** "FRI 10 OCT": the night the event belongs to (a 1am start is the night before). */
export function shareDate(startsAt: string) {
  const d = new Date(`${nightOf(Date.parse(startsAt))}T12:00:00Z`);
  const weekday = d.toLocaleDateString("en-NG", { weekday: "short", timeZone: "UTC" });
  const month = d.toLocaleDateString("en-NG", { month: "short", timeZone: "UTC" });
  return `${weekday} ${d.getUTCDate()} ${month}`.toUpperCase();
}

/** WhatsApp-ready: "SOUTH SOCIAL · FRI 10 OCT · 11PM · LEKKI PHASE 1 · ₦10,000 · 23 Hoppers going". */
export function shareText(event: EventRow, going: number) {
  const lead = isEventLead(event);
  const parts = [
    eventTitle(event).toUpperCase(),
    lead ? "TIME TBC" : shareDate(event.starts_at),
    lead ? null : clockShort(event.starts_at),
    event.area?.toUpperCase() ?? null,
    lead ? null : eventPrice(event),
    going > 0 ? `${going} Hopper${going === 1 ? "" : "s"} going` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

/** The link that opens this one event on the map. */
export function shareUrl(eventId: string) {
  return `${window.location.origin}/?e=${encodeURIComponent(eventId)}`;
}

/**
 * Opens the phone's share sheet; where there is none, copies the text and link.
 * Returns "shared", "copied", "cancelled" or "failed".
 */
export async function shareEvent(event: EventRow, going: number): Promise<"shared" | "copied" | "cancelled" | "failed"> {
  const text = shareText(event, going);
  const url = shareUrl(event.id);
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ title: eventTitle(event), text, url });
      return "shared";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
      // Any other failure falls through to copying.
    }
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    return "copied";
  } catch {
    return "failed";
  }
}
