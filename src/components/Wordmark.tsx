/* eslint-disable @next/next/no-img-element -- small static brand files, no layout shift (fixed height) */

/**
 * The real Hoppaz wordmark, ears on. Files live in public/brand/.
 * Brand pairs: cream on orange or night, ink (black) on cream, orange on black.
 * tone "auto" follows the theme: cream on the night ground, ink on the day ground.
 * size is the cap height of the letters in px; the ears rise above it.
 */
export default function Wordmark({
  size = 17,
  tone = "auto",
  className,
}: {
  size?: number;
  tone?: "auto" | "cream" | "orange" | "ink";
  className?: string;
}) {
  // The file is 720 x 226; the letters take the lower ~58% of its height.
  const height = Math.round(size / 0.58);
  const img = (file: string, extra = "") => (
    <img
      src={`/brand/wordmark-${file}.png`}
      alt=""
      aria-hidden
      draggable={false}
      height={height}
      style={{ height, width: "auto" }}
      className={`block select-none ${extra}`}
    />
  );
  return (
    <span role="img" aria-label="Hoppaz" className={`inline-flex ${className ?? ""}`}>
      {tone === "auto" ? (
        <>
          {img("cream", "night-only")}
          {img("ink", "day-only")}
        </>
      ) : (
        img(tone)
      )}
    </span>
  );
}
