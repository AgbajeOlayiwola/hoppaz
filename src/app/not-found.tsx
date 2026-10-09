import Link from "next/link";
import Mascot from "@/components/Mascot";

/**
 * A wrong link: the mascot caught out, one line, one way home.
 * Renders inside the root layout, so the tab bar stays and the theme follows the clock.
 */
export default function NotFound() {
  return (
    <div className="h-full overflow-y-auto px-6">
      <div className="mx-auto flex min-h-full max-w-sm flex-col items-center justify-center py-10 text-center">
        <p className="seclabel">404 · WRONG STOP</p>
        <Mascot state="oops" size={150} className="mt-3" />
        <h1 className="mt-4 text-balance font-display text-[28px] font-black leading-[1.1]">That page has gone home.</h1>
        <Link href="/" className="btn mt-6">
          BACK TO TODAY
        </Link>
      </div>
    </div>
  );
}
