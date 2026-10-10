import { notFound } from "next/navigation";

/**
 * Development only: the admin desk's Hotspots section on its own, with no staff token and no network
 * (http://localhost:3100/dev/hotspot-admin). It shows whatever a script hands it through window.__hzAdmin.set(data)
 * and records each action it would send in window.__acts, so a script can check the buttons and the handlers
 * against each other. It can change nothing. Production builds answer 404.
 */
export default async function DevHotspotAdminPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  } else {
    const { default: DevHotspotAdmin } = await import("./DevHotspotAdmin");
    return <DevHotspotAdmin />;
  }
}
