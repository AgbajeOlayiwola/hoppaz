import { notFound } from "next/navigation";
import DevIntro from "./DevIntro";

/**
 * Development only: Paz's first-run tour over a fake app, with a button for
 * every event (http://localhost:3000/dev/intro). Production builds answer
 * 404, so players never see it.
 *
 * Query: ?step=box_far jumps to a step. ?theme=day|night. ?panel=1 opens the
 * controls. ?loc=denied|outside|granted. ?ios=1 pretends to be an iPhone that
 * has not been installed.
 */
export default function DevIntroPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <DevIntro />;
}
