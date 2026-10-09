import { ImageResponse } from "next/og";
import { SiteShareCard } from "@/app/api/og/_cards";
import { brandImage, loadFonts } from "@/app/api/og/_lib";

/**
 * The card chat apps show when the plain site is shared (the map, and any page
 * without a card of its own). An event page has its own: /api/og/event/<id>.
 */

export const alt = "Hoppaz. What is on in Lagos today, on one map. Come alone, leave with friends.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const [fonts, wordmark] = await Promise.all([loadFonts(), brandImage("wordmark")]);
  return new ImageResponse(<SiteShareCard wordmark={wordmark} />, { ...size, fonts });
}
