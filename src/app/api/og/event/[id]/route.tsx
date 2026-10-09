import { brandImage, loadFlyer, loadFonts, loadShareEvent } from "../../_lib";
import { EventShareCard, SiteShareCard, renderPng } from "../../_cards";

/**
 * GET /api/og/event/<id>: the event's share card, 1200 x 630 PNG, for link
 * previews (WhatsApp, X, iMessage, Slack). The event page points its og:image
 * here (src/app/event/[id]/layout.tsx). Public, no login: it only shows what
 * the event page already shows.
 */

// The event page adds ?v=<hash of what the card shows>, so a changed event is a new address.
// An hour on the CDN, a day of "show the old one while fetching the new one".
const CACHE = "public, max-age=600, s-maxage=3600, stale-while-revalidate=86400";
// An event that is not found draws the site card, briefly, so it can be found once it exists.
const BRIEF = "public, max-age=60, s-maxage=300";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [fonts, event, wordmark, mark] = await Promise.all([loadFonts(), loadShareEvent(id), brandImage("wordmark"), brandImage("mark")]);

  try {
    if (!event) return await renderPng(<SiteShareCard wordmark={wordmark} />, fonts, BRIEF);
    const flyer = await loadFlyer(event.flyer_url);
    try {
      return await renderPng(<EventShareCard event={event} flyer={flyer} wordmark={wordmark} mark={mark} />, fonts, CACHE);
    } catch (e) {
      if (!flyer) throw e;
      // A flyer the drawing library cannot read costs the flyer, not the card.
      return await renderPng(<EventShareCard event={event} flyer={null} wordmark={wordmark} mark={mark} />, fonts, BRIEF);
    }
  } catch (e) {
    console.warn("[hoppaz] share card failed:", e instanceof Error ? e.message : e);
    return new Response("Could not draw the card.", { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
