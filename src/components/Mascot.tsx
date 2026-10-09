"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";

/**
 * The Hoppaz mascot, ported from the Mascot Rig v3. One SVG, one state
 * machine; the motion lives in globals.css under `svg.rig`.
 *
 * Where it may appear (design system): first run and install, empty states,
 * the drop reveal, a badge or rank change, errors, the month report card, and
 * small and permanent on Me. Never on the map, the event list or in chat.
 */
export type MascotState =
  | "idle"
  | "wave"
  | "welcome"
  | "oya"
  | "secret"
  | "point"
  | "celebrate"
  | "win"
  | "oops"
  | "sleep";

/** One-shot states fall back to idle after they have played. */
const ONE_SHOT: Partial<Record<MascotState, number>> = { win: 2600, oops: 2200, celebrate: 2600 };

export default function Mascot({
  state = "idle",
  size = 120,
  edge = "ground",
  sleepAfterMs,
  className,
  label = "Hoppaz mascot",
}: {
  state?: MascotState;
  size?: number;
  /** ground: keyline in the ground colour (default). ink: sticker edge for the loud layer. */
  edge?: "ground" | "ink";
  /** Drift to sleep after this long untouched. Off by default. */
  sleepAfterMs?: number;
  className?: string;
  label?: string;
}) {
  const [shown, setShown] = useState<MascotState>(state);
  const [poke, setPoke] = useState(false);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setShown(state);
    const back = ONE_SHOT[state];
    if (!back) return;
    const t = setTimeout(() => setShown("idle"), back);
    return () => clearTimeout(t);
  }, [state]);

  useEffect(() => {
    if (!sleepAfterMs || shown === "sleep") return;
    idle.current = setTimeout(() => setShown("sleep"), sleepAfterMs);
    return () => {
      if (idle.current) clearTimeout(idle.current);
    };
  }, [shown, sleepAfterMs]);

  const tap = () => {
    if (shown === "sleep") {
      setShown("wave");
      return;
    }
    setPoke(false);
    requestAnimationFrame(() => setPoke(true));
    setTimeout(() => setPoke(false), 460);
  };

  return (
    <svg
      className={clsx("rig", poke && "poke", className)}
      data-state={shown}
      viewBox="0 0 600 700"
      width={size}
      height={(size * 700) / 600}
      role="img"
      aria-label={label}
      onClick={tap}
      style={edge === "ink" ? ({ ["--rig-edge" as string]: "#0E0B0A" } as React.CSSProperties) : undefined}
    >
      <g id="character">
        <g>
          <path className="rc" d="M255 585 C249 607 242 629 241 644 C205 630 175 639 160 660 C149 678 173 685 210 680 L246 680 C273 678 282 661 279 638 L280 588 Z" />
          <path className="rc" d="M320 588 L321 638 C318 661 327 678 354 680 L390 680 C427 685 451 678 440 660 C425 639 395 630 359 644 C358 629 351 607 345 585 Z" />
          <path className="rc" d="M300 475 C250 475 220 513 220 562 C220 612 249 628 300 628 C351 628 380 612 380 562 C380 513 350 475 300 475 Z" />
        </g>
        <g id="arm-left">
          <path className="rc" d="M234 507 C217 534 194 548 173 535 C155 524 146 512 142 495 L124 500 C124 537 145 568 178 573 C214 579 238 560 255 526 Z" />
          <g id="left-mitten">
            <path className="rc" d="M143 502 C127 500 114 484 106 472 C93 452 77 459 81 476 C69 458 54 467 60 484 C50 469 35 481 42 499 C52 527 78 543 106 538 C125 535 141 524 143 502 Z" />
          </g>
          <g id="point-left-hand">
            <path className="rc" d="M143 501 C125 489 104 492 83 496 L30 495 C18 496 18 514 31 515 L82 517 C101 536 122 539 143 525 Z" />
          </g>
        </g>
        <g id="arm-right">
          <path className="rc" d="M366 507 C383 534 406 548 427 535 C445 524 454 512 458 495 L476 500 C476 537 455 568 422 573 C386 579 362 560 345 526 Z" />
          <g id="right-mitten">
            <path className="rc" d="M457 502 C473 500 486 484 494 472 C507 452 523 459 519 476 C531 458 546 467 540 484 C550 469 565 481 558 499 C548 527 522 543 494 538 C475 535 459 524 457 502 Z" />
          </g>
          <g id="point-right-hand">
            <path className="rc" d="M457 501 C475 489 496 492 517 496 L570 495 C582 496 582 514 569 515 L518 517 C499 536 478 539 457 525 Z" />
          </g>
        </g>
        <g id="head">
          <g id="ear-left">
            <path className="rc" d="M205 248 C162 201 132 127 141 75 C148 31 179 24 215 49 C265 83 279 169 278 242 Z" />
            <path className="ro" d="M210 224 C176 177 155 114 164 75 C168 58 174 52 185 55 C229 67 255 146 255 225 Z" />
            <path fill="#F5EBDD" d="M211 217 C185 173 174 120 181 87 C188 64 213 102 229 145 C239 172 241 198 239 223 Z" />
          </g>
          <g id="ear-right">
            <path className="rc" d="M332 247 C333 166 351 87 392 73 C434 57 462 85 481 123 C496 153 512 166 534 178 C541 184 539 195 531 202 C503 229 450 223 414 203 C397 194 384 183 374 169 C370 198 360 224 349 247 Z" />
            <path className="ro" d="M353 227 C356 161 370 99 399 92 C426 84 444 106 461 139 C475 167 491 180 516 190 C489 207 450 202 422 184 C400 170 389 148 380 132 C371 150 367 191 353 227 Z" />
            <path fill="#F5EBDD" d="M360 224 C367 181 370 131 384 117 C394 109 400 132 413 151 C422 166 431 176 446 181 C421 186 403 170 391 153 C385 184 372 211 360 224 Z" />
          </g>
          <circle className="rc" cx="300" cy="341" r="151" />
          <circle className="ro" cx="300" cy="341" r="96" />
          <g id="cheeks" fill="#ff9469" opacity=".68">
            <ellipse cx="230" cy="357" rx="13" ry="6" />
            <ellipse cx="370" cy="357" rx="13" ry="6" />
          </g>
          <g id="face-default" className="face">
            <path d="M249 329 L273 333" fill="none" stroke="#F5EBDD" strokeWidth="11" strokeLinecap="round" />
            <circle cx="344" cy="324" r="12" fill="#0E0B0A" />
            <path d="M274 368 Q300 390 326 368" fill="none" stroke="#F5EBDD" strokeWidth="11" strokeLinecap="round" />
          </g>
          <g id="face-closed" className="face" fill="none" stroke="#F5EBDD" strokeWidth="10" strokeLinecap="round">
            <path d="M245 330 Q260 339 275 330" />
            <path d="M325 330 Q340 339 355 330" />
            <path d="M293 373 Q300 378 307 373" strokeWidth="8" />
          </g>
          <g id="face-wow" className="face">
            <circle cx="257" cy="327" r="10" fill="#0E0B0A" />
            <circle cx="343" cy="327" r="10" fill="#0E0B0A" />
            <ellipse cx="300" cy="371" rx="12" ry="16" fill="#F5EBDD" />
          </g>
          <g id="face-happy" className="face" fill="none" stroke="#F5EBDD" strokeLinecap="round">
            <path d="M242 331 Q258 312 274 331 M326 331 Q342 312 358 331" strokeWidth="10" />
            <path d="M269 365 Q300 405 331 365" strokeWidth="12" />
          </g>
          <g id="face-invite" className="face">
            <circle cx="258" cy="326" r="11" fill="#0E0B0A" />
            <circle cx="342" cy="326" r="11" fill="#0E0B0A" />
            <path d="M267 365 Q300 402 333 365" fill="none" stroke="#F5EBDD" strokeWidth="12" strokeLinecap="round" />
          </g>
          <g id="face-secret" className="face">
            <path d="M244 330 Q259 319 274 330" fill="none" stroke="#F5EBDD" strokeWidth="9" strokeLinecap="round" />
            <circle cx="342" cy="326" r="11" fill="#0E0B0A" />
            <ellipse cx="305" cy="367" rx="9" ry="12" fill="#F5EBDD" />
          </g>
        </g>
        <g id="secret-arm">
          <path d="M232 512 C219 481 218 447 227 413 C232 393 249 378 269 373" fill="none" stroke="#F5EBDD" strokeLinecap="round" />
          <path className="rc" d="M254 358 C256 346 266 342 273 352 C279 341 290 344 289 356 C294 348 304 353 300 365 C295 380 284 391 270 389 C257 387 250 374 254 358 Z" />
        </g>
      </g>
    </svg>
  );
}
