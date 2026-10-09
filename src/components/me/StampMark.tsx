import clsx from "clsx";
import { Building2, Bus, MapPinned, Mic, Moon, Palmtree, Stamp, Ticket, Waves } from "lucide-react";

/**
 * A badge as a rubber stamp: one colour, a ring inside a ring, a line icon in
 * the middle, a couple of degrees off square. The colour is the text colour,
 * so it is cream on the night ground and ink on the day ground by itself.
 * The names are the `icon` field on a BADGES entry (src/lib/brand.ts).
 */
function Glyph({ name, size }: { name?: string; size: number }) {
  const p = { size, strokeWidth: 2 };
  switch (name) {
    case "Building2":
      return <Building2 {...p} />;
    case "Bus":
      return <Bus {...p} />;
    case "MapPinned":
      return <MapPinned {...p} />;
    case "Mic":
      return <Mic {...p} />;
    case "Moon":
      return <Moon {...p} />;
    case "Palmtree":
      return <Palmtree {...p} />;
    case "Ticket":
      return <Ticket {...p} />;
    case "Waves":
      return <Waves {...p} />;
    default:
      return <Stamp {...p} />;
  }
}

export default function StampMark({
  icon,
  size = 52,
  earned = true,
  stamp = false,
}: {
  icon?: string;
  size?: number;
  earned?: boolean;
  /** Play the 180ms stamp-in (a badge you have not seen before). */
  stamp?: boolean;
}) {
  return (
    <span aria-hidden className={clsx("inline-block flex-none", stamp && "animate-stamp")}>
      <span
        className={clsx(
          "relative grid place-items-center rounded-full border-2 border-current",
          earned ? "text-cream" : "border-dashed text-dim opacity-80"
        )}
        style={{ width: size, height: size, transform: "rotate(-4deg)" }}
      >
        <span
          className="absolute rounded-full border border-current opacity-40"
          style={{ inset: Math.round(size * 0.1) }}
        />
        <Glyph name={icon} size={Math.round(size * 0.42)} />
      </span>
    </span>
  );
}
