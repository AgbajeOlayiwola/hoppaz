import { BookOpen, ChevronLeft, ChevronRight, Copy, Share, SquarePlus } from "lucide-react";
import { EXTRA } from "@/lib/intro/lines";
import s from "./intro.module.css";

/**
 * The picture on Paz's iPhone install cards. "taps": Safari's bar with Share
 * lit, then the sheet row Add to Home Screen lit. "home": the Hoppaz icon on a
 * row of the home screen. Drawn, not photographed, so it follows the theme.
 */
export default function InstallPicture({ kind }: { kind: "taps" | "home" }) {
  if (kind === "home") {
    return (
      <div className={s.pic} role="img" aria-label={EXTRA.homeLabel}>
        <div className={s.homeRow}>
          <i className={s.tile} />
          <i className={s.tile} />
          <span className={s.tileMe}>
            <span className={s.tileIcon} style={{ backgroundImage: "url(/icon-192.png)" }} />
            <i className={s.tileRing} />
          </span>
          <i className={s.tile} />
        </div>
        <p className={s.picCap}>HOPPAZ</p>
      </div>
    );
  }
  return (
    <div className={s.pic} role="img" aria-label={EXTRA.tapsLabel}>
      <div className={s.taps}>
        <div className={s.tap}>
          <div className={s.safariBar} aria-hidden>
            <ChevronLeft size={16} strokeWidth={2} />
            <ChevronRight size={16} strokeWidth={2} />
            <span className={s.lit}>
              <Share size={18} strokeWidth={2.2} />
            </span>
            <BookOpen size={16} strokeWidth={2} />
            <Copy size={16} strokeWidth={2} />
          </div>
          <p className={s.picCap}>
            <b>1</b> Tap Share
          </p>
        </div>
        <div className={s.tap}>
          <div className={s.sheetRow} aria-hidden>
            <span className={s.sheetText}>Add to Home Screen</span>
            <span className={s.lit}>
              <SquarePlus size={18} strokeWidth={2.2} />
            </span>
          </div>
          <p className={s.picCap}>
            <b>2</b> Add to Home Screen
          </p>
        </div>
      </div>
    </div>
  );
}
