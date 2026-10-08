/**
 * Tiny per-phone memory for Me ("what did I last see here"). Private mode and
 * blocked storage just mean nothing is remembered, so nothing stamps.
 */
export function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* nothing to remember it with */
  }
}
