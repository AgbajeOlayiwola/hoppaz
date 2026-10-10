import { useId } from "react";

/**
 * The Visited stamp: a rubber stamp in black ink, a ring inside a ring, HOPPAZ round the top, VISITED between
 * two rules and the play-day date round the bottom. Drawn in code so it sits on any card, at any size.
 * The date has its own class so a tile can drop it (CardFace.module.css).
 */
export default function VisitedStamp({ date, dateClassName }: { date?: string; dateClassName?: string }) {
  const id = useId();
  const ink = "#0E0B0A";
  const mono = { fontFamily: "var(--font-mono), ui-monospace, monospace", fontWeight: 500 } as const;
  return (
    <svg viewBox="0 0 120 120" aria-hidden className="block w-full overflow-visible" fill="none" stroke={ink}>
      <defs>
        <path id={`${id}t`} d="M 24 60 A 36 36 0 0 1 96 60" />
        <path id={`${id}b`} d="M 16 60 A 44 44 0 0 0 104 60" />
      </defs>
      <circle cx="60" cy="60" r="56" strokeWidth="4.5" opacity="0.92" />
      <circle cx="60" cy="60" r="49" strokeWidth="1.6" opacity="0.92" />
      <text fill={ink} stroke="none" fontSize="10" letterSpacing="3.4" textAnchor="middle" style={mono}>
        <textPath href={`#${id}t`} startOffset="50%">
          HOPPAZ
        </textPath>
      </text>
      <path d="M 18 48 H 102 M 18 77 H 102" strokeWidth="1.8" opacity="0.92" />
      <text x="60" y="70" fill={ink} stroke="none" fontSize="19" textAnchor="middle" style={{ fontFamily: "var(--font-poppins), system-ui, sans-serif", fontWeight: 900 }}>
        VISITED
      </text>
      <g className={dateClassName}>
        <text fill={ink} stroke="none" fontSize="10" letterSpacing="2.6" textAnchor="middle" style={mono}>
          <textPath href={`#${id}b`} startOffset="50%">
            {date || "SEASON 1"}
          </textPath>
        </text>
      </g>
    </svg>
  );
}
