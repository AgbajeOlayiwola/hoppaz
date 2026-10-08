/**
 * Theme follows the Lagos clock (design system, decision 1): cream ground by
 * day, Night Black after sunset, on the website and in the app alike.
 * Lagos is UTC+1 all year, and sunset there barely moves (about 6:30 to 7pm),
 * so a fixed window is close enough and never flickers.
 *
 * ?theme=day or ?theme=night forces one for the session (testing, screenshots).
 */

export type Theme = "day" | "night";

/** Day runs 6:30am to 6:45pm Lagos time. */
export const DAY_FROM_MIN = 6 * 60 + 30;
export const DAY_UNTIL_MIN = 18 * 60 + 45;

export const THEME_COLOR: Record<Theme, string> = { day: "#F5EBDD", night: "#0E0B0A" };

export function lagosMinutes(ms = Date.now()) {
  const d = new Date(ms + 3.6e6);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export function themeAt(ms = Date.now()): Theme {
  const m = lagosMinutes(ms);
  return m >= DAY_FROM_MIN && m < DAY_UNTIL_MIN ? "day" : "night";
}

/** An event's card follows the event's own start time, not the page. */
export function themeForEvent(startsAt: string): Theme {
  return themeAt(Date.parse(startsAt));
}

/**
 * Runs inline in <head> before first paint so the page never flashes the
 * wrong ground. Kept tiny and dependency free; mirrors themeAt above.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{
var q=new URLSearchParams(location.search).get("theme");
if(q==="day"||q==="night"){sessionStorage.setItem("hz-theme",q)}
var f=sessionStorage.getItem("hz-theme");
var d=new Date(Date.now()+36e5),m=d.getUTCHours()*60+d.getUTCMinutes();
var t=f||(m>=${DAY_FROM_MIN}&&m<${DAY_UNTIL_MIN}?"day":"night");
document.documentElement.setAttribute("data-theme",t);
var c=document.querySelector('meta[name="theme-color"]');if(c)c.setAttribute("content",t==="day"?"${THEME_COLOR.day}":"${THEME_COLOR.night}");
}catch(e){document.documentElement.setAttribute("data-theme","night")}})();`;

export function forcedTheme(): Theme | null {
  try {
    const f = sessionStorage.getItem("hz-theme");
    return f === "day" || f === "night" ? f : null;
  } catch {
    return null;
  }
}
