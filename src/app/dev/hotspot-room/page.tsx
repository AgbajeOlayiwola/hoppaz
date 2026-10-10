import { notFound } from "next/navigation";

/**
 * Development only: the hotspot room over a plain ground, without the map or Play
 * (http://localhost:3100/dev/hotspot-room?slug=yaba&auto=1). Production builds answer 404.
 */
export default async function DevHotspotRoomPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  } else {
    const { default: DevHotspotRoom } = await import("./DevHotspotRoom");
    return <DevHotspotRoom />;
  }
}
