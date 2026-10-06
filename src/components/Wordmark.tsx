/**
 * The wordmark. Poppins Black, letters alternating tilt (odd -4deg, even +4deg),
 * one flat baseline, even spacing, no overlaps. Bunny ears live on the asset
 * version; this is the type-only lockup for in-app chrome.
 */
export default function Wordmark({ size = 17 }: { size?: number }) {
  return (
    <span
      className="inline-flex items-end bg-orange px-2.5 pt-1.5 pb-1 rounded-sm shadow-chunk select-none"
      aria-label="Hoppaz"
    >
      {"HOPPAZ".split("").map((c, i) => (
        <span
          key={i}
          aria-hidden
          className="inline-block font-display font-black leading-none text-cream"
          style={{
            fontSize: size,
            transformOrigin: "50% 60%",
            transform: `rotate(${i % 2 === 0 ? -4 : 4}deg)`,
          }}
        >
          {c}
        </span>
      ))}
    </span>
  );
}
