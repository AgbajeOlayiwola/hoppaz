import type { Metadata } from "next";
import ReportPoster from "@/components/app/ReportPoster";

// A private link: keep it out of search, and give WhatsApp a plain line to show.
export const metadata: Metadata = {
  title: "Outside report · Hoppaz",
  description: "A month of nights out across Lagos.",
  robots: { index: false, follow: false },
};

export default async function SharedReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ReportPoster token={token} />;
}
