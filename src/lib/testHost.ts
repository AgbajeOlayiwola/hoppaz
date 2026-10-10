/**
 * The hosts we test on: this Mac, a phone on the same Wi-Fi, the Cloudflare tunnel. Not vercel.app: a preview there is a real link.
 * (/reset has its own, wider list, because wiping a browser is harmless anywhere; this one changes what Play does.)
 *
 * Play needs a real position to make boxes. A browser that refuses location (the Claude Browser pane does, so does a laptop with
 * Location Services off) would never see one, so on these hosts a picked area stands in for it, as it does in development. Anywhere
 * else the build behaves exactly as it ships.
 */
const TEST_HOST =
  /^(localhost|127\.0\.0\.1|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[a-z0-9-]+\.trycloudflare\.com)$/i;

export const isTestHost = () => typeof location !== "undefined" && TEST_HOST.test(location.hostname);
