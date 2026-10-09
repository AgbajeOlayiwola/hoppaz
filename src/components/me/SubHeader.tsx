import Link from "next/link";
import { ChevronLeft } from "lucide-react";

/**
 * The one sub-page header: a 44px back chevron, a Poppins Black title and a
 * mono caption. Tab pages have no back button; pages reached from a tab do.
 */
export default function SubHeader({
  backHref,
  backLabel,
  title,
  caption,
}: {
  backHref: string;
  backLabel: string;
  title: string;
  caption?: string;
}) {
  return (
    <header className="pad-top flex items-center gap-1 pb-5">
      <Link
        href={backHref}
        aria-label={`Back to ${backLabel}`}
        className="-ml-3 grid h-11 w-11 flex-none place-items-center text-cream"
      >
        <ChevronLeft size={26} strokeWidth={2.2} />
      </Link>
      <div className="min-w-0">
        <h1 className="font-display text-[26px] font-black leading-none">{title}</h1>
        {caption && <p className="seclabel mt-1.5">{caption}</p>}
      </div>
    </header>
  );
}
