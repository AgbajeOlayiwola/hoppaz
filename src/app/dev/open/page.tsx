import { notFound } from "next/navigation";

/**
 * Development only: the Play open moment over a plain background, without the
 * map (http://localhost:3000/dev/open). Production builds answer 404, so
 * players never see it. The page is imported inside the development branch, so
 * a production build leaves it (and the test-only sound rendering) out.
 */
export default async function DevOpenPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  } else {
    const { default: DevOpen } = await import("./DevOpen");
    return <DevOpen />;
  }
}
