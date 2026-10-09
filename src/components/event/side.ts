/**
 * On the map, an open event docks on the right as a tall card and the venue's
 * house stands in the strip of map left of it. The card and the camera both
 * size themselves from these numbers, so the house never ends up under the card.
 */
export const SIDE_PANEL = {
  /** Share of the map's width the card takes, at most `max` px. */
  share: 0.58,
  max: 320,
  /** Space between the card and the screen edge, and between the card and the house's strip. */
  gap: 8,
} as const;

/** The card's width in px on a map `vw` px wide. Same rule as the card's CSS width. */
export const sidePanelWidth = (vw: number) => Math.min(Math.round(vw * SIDE_PANEL.share), SIDE_PANEL.max);

/** The card's CSS width, from the same numbers. */
export const SIDE_PANEL_CSS_WIDTH = `min(${SIDE_PANEL.share * 100}%, ${SIDE_PANEL.max}px)`;
