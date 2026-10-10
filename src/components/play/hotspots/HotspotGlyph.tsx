/** The hotspot's crossroads: two roads crossing, a ring of ground around the junction. Cream on the dark disc. */
export default function HotspotGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="none">
      <path d="M12 2.5v19" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" />
      <path d="M2.5 12h19" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="12" cy="12" r="4.2" fill="#0e0b0a" />
      <circle cx="12" cy="12" r="1.9" fill="currentColor" />
    </svg>
  );
}
