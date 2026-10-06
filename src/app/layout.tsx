import type { Metadata, Viewport } from "next";
// Fonts are self-hosted on purpose: no Google round trip on a Lagos connection,
// and the build never depends on fonts.googleapis.com being reachable.
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/600.css";
import "@fontsource/poppins/900.css";
import "@fontsource/space-mono/400.css";
import "@fontsource/space-mono/700.css";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import BottomNav from "@/components/BottomNav";
import Toaster from "@/components/Toaster";

export const metadata: Metadata = {
  title: "Hoppaz",
  description:
    "What is happening in Lagos tonight, on one map. Come alone, leave with friends.",
  applicationName: "Hoppaz",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Hoppaz" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#0E0B0A",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="overflow-hidden">
        <div className="fixed inset-0 flex flex-col">
          <main className="relative flex-1 min-h-0">{children}</main>
          <BottomNav />
        </div>
        <Toaster />
      </body>
    </html>
  );
}
