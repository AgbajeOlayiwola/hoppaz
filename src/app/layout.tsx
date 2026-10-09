import type { Metadata, Viewport } from "next";
// Fonts are self-hosted on purpose: no Google round trip on a Lagos connection,
// and the build never depends on fonts.googleapis.com being reachable.
// Poppins: display and numbers only, never below 600. Archivo: everything you
// read. DM Mono: labels, dates, prices, codes.
import "@fontsource/poppins/600.css";
import "@fontsource/poppins/900.css";
import "@fontsource/archivo/400.css";
import "@fontsource/archivo/500.css";
import "@fontsource/archivo/600.css";
import "@fontsource/dm-mono/400.css";
import "@fontsource/dm-mono/500.css";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import BottomNav from "@/components/BottomNav";
import Toaster from "@/components/Toaster";
import ThemeClock from "@/components/ThemeClock";
import OfflineLine from "@/components/app/OfflineLine";
import InstallSheet from "@/components/app/InstallSheet";
import SignupSheet from "@/components/app/SignupSheet";
import IntroHost from "@/components/intro/IntroHost";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";

const DESCRIPTION = "What is happening in Lagos today, on one map. Come alone, leave with friends.";

/** Absolute links in previews: the site's own address when it is set, otherwise Next works it out (Vercel's, or localhost). */
function siteBase() {
  try {
    return process.env.NEXT_PUBLIC_SITE_URL ? new URL(process.env.NEXT_PUBLIC_SITE_URL) : undefined;
  } catch {
    return undefined;
  }
}

export const metadata: Metadata = {
  metadataBase: siteBase(),
  title: "Hoppaz",
  description: DESCRIPTION,
  // Shared links: a Hoppaz card (src/app/opengraph-image.tsx), not a bare text link. An event page has its own card.
  openGraph: { type: "website", siteName: "Hoppaz", locale: "en_NG", title: "Hoppaz", description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: "Hoppaz", description: DESCRIPTION },
  applicationName: "Hoppaz",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Hoppaz" },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // No maximumScale: people can pinch-zoom text pages. The map handles its own pinch.
  viewportFit: "cover",
  themeColor: "#0E0B0A",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme is set before paint by the boot script, so the server and
    // client attribute differ on purpose.
    <html lang="en" data-theme="night" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="overflow-hidden">
        <ThemeClock />
        <div className="fixed inset-0 flex flex-col">
          <OfflineLine />
          <main className="relative flex-1 min-h-0">{children}</main>
          <BottomNav />
        </div>
        <Toaster />
        <SignupSheet />
        <InstallSheet />
        <IntroHost />
      </body>
    </html>
  );
}
