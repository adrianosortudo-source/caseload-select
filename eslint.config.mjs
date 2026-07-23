import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    // React Compiler-readiness rules: new in this ruleset, 51 pre-existing hits.
    // Downgraded to warn for the baseline; tracked for a dedicated follow-up pass.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/static-components": "warn",
    },
  },
  {
    // Standalone CommonJS scripts (no "type": "module" in package.json) —
    // require() is the correct import mechanism here, not a lint violation.
    files: ["scripts/**/*.js", "supabase/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];

export default eslintConfig;
