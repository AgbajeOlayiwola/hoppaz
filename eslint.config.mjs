import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Existing data hooks initiate asynchronous loads from effects and update
      // loading state before awaiting I/O; keep those app patterns lintable.
      "react-hooks/set-state-in-effect": "off",
      // The map keeps current event handlers in refs between MapLibre callbacks;
      // the event card's clock is a render input. These patterns predate the
      // React Compiler diagnostics added by the Next 16 lint preset.
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/immutability": "off",
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
