import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Development only: Next's round "N" badge floats top right on every screen, over the map's Locate button and the Me mascot,
  // so a tap meant for the app lands on it. A production build never has it. Errors still show their own overlay.
  devIndicators: false,
  // The card art is a fixed set of WebP files and every URL the app builds carries ?v=<art_version> (src/lib/cards.ts, artUrl), so a
  // new image is a new URL. Cache them for a year; Next's default for /public is max-age=0, which re-checks 9 MB on every visit.
  async headers() {
    return [{ source: "/cards/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] }];
  },
  images: {
    remotePatterns: [
      // Supabase Storage public bucket for flyers
      { protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/public/**" },
    ],
  },
};

export default nextConfig;
