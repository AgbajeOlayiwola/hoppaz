import { nightOf } from "@/lib/filters";
import { clockShort, eventPrice, eventTitle, isEventLead } from "@/lib/geo";
import type { EventRow } from "@/lib/types";

/** "Fri 10 Oct": the night the event belongs to (a 1am start is the night before). */
function nightLabel(startsAt: string) {
  const d = new Date(`${nightOf(Date.parse(startsAt))}T12:00:00Z`);
  const weekday = d.toLocaleDateString("en-NG", { weekday: "short", timeZone: "UTC" });
  const month = d.toLocaleDateString("en-NG", { month: "short", timeZone: "UTC" });
  return `${weekday} ${d.getUTCDate()} ${month}`;
}

/** "FRI 10 OCT" */
export function shareDate(startsAt: string) {
  return nightLabel(startsAt).toUpperCase();
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

/**
 * What chat apps show under the link: the event's name and one line of facts,
 * "Fri 10 Oct, 11PM · Victoria Island · Free. See who is going on Hoppaz."
 * The event page's metadata uses this, so the preview and the shared text agree.
 */
export function sharePreview(event: Pick<EventRow, "title" | "starts_at" | "area" | "price_naira">) {
  const lead = isEventLead(event);
  const facts = [
    lead ? `${nightLabel(event.starts_at)}, time to be confirmed` : `${nightLabel(event.starts_at)}, ${clockShort(event.starts_at)}`,
    event.area,
    lead ? null : event.price_naira > 0 ? eventPrice(event) : "Free",
  ];
  return {
    title: `${eventTitle(event)} | Hoppaz`,
    description: `${facts.filter(Boolean).join(" · ")}. See who is going on Hoppaz.`,
  };
}

/**
 * The link that opens this one event's page in Hoppaz: the flyer, the facts,
 * who is going, and I'M GOING. Shared links come back to Hoppaz, and chat apps
 * show the event's card (see src/app/event/[id]/layout.tsx). The older
 * /?e=<id> map link still works for anyone who has one.
 */
export function shareUrl(eventId: string) {
  return `${window.location.origin}/event/${encodeURIComponent(eventId)}`;
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
