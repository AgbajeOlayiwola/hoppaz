import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Development only: Next's round "N" badge floats top right on every screen, over the map's Locate button and the Me mascot,
  // so a tap meant for the app lands on it. A production build never has it. Errors still show their own overlay.
  devIndicators: false,
  images: {
    remotePatterns: [
      // Supabase Storage public bucket for flyers
      { protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/public/**" },
    ],
  },
};

export default nextConfig;
