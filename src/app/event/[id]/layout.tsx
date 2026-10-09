import type { Metadata } from "next";
import { cardVersion, loadShareEvent, siteOrigin } from "@/app/api/og/_lib";
import { sharePreview } from "@/components/event/share";
import { eventTitle } from "@/lib/geo";

/**
 * What a shared event link looks like in WhatsApp, X, iMessage and Slack: the
 * event's name and facts, and its card (the flyer in the Hoppaz frame). The
 * page itself is a client component, so the tags live here, in the layout.
 * An event that is not found (ended, removed) keeps the site's own card.
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const event = await loadShareEvent(id);
  if (!event) return {};

  const origin = await siteOrigin();
  const { title, description } = sharePreview(event);
  const url = `${origin}/event/${encodeURIComponent(id)}`;
  const image = `${origin}/api/og/event/${encodeURIComponent(id)}?v=${cardVersion(event)}`;

  return {
    metadataBase: new URL(origin),
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      siteName: "Hoppaz",
      locale: "en_NG",
      url,
      title,
      description,
      images: [{ url: image, width: 1200, height: 630, alt: `${eventTitle(event)} on Hoppaz` }],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default function EventLayout({ children }: { children: React.ReactNode }) {
  return children;
}
