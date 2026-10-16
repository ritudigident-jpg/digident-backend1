// ESLint rules for the backend (flat config). Run: npm run lint
// Rules follow docs/CODING_STANDARDS.md. "warn" rules are being cleaned up file by file.
import js from "@eslint/js";

const nodeGlobals = Object.fromEntries(
  [
    "process",
    "console",
    "Buffer",
    "URL",
    "URLSearchParams",
    "setTimeout",
    "clearTimeout",
    "setInterval",
    "clearInterval",
    "setImmediate",
    "structuredClone",
    "fetch",
    "AbortController",
    "AbortSignal",
  ].map((name) => [name, "readonly"])
);

export default [
  { ignores: ["node_modules/**", "coverage/**"] },
  js.configs.recommended,
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: nodeGlobals },
    rules: {
      "no-console": "error",
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_|^next$|^req$|^res$", caughtErrors: "none", ignoreRestSiblings: true },
      ],
      "no-empty": ["error", { allowEmptyCatch: false }],
      "no-throw-literal": "error",
      "prefer-const": "error",
      "no-var": "error",
      eqeqeq: ["warn", "smart"],
      "max-lines": ["warn", { max: 400, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["warn", { max: 80, skipBlankLines: true, skipComments: true }],
      "max-depth": ["warn", 4],
      "no-magic-numbers": [
        "warn",
        {
          ignore: [-1, 0, 1, 2, 100, 1000],
          ignoreArrayIndexes: true,
          ignoreDefaultValues: true,
          enforceConst: true,
        },
      ],
      "id-length": ["warn", { min: 2, exceptions: ["i", "j", "_"] }],
    },
  },
  {
    files: ["src/helpers/logger.helper.js", "scripts/**"],
    rules: { "no-console": "off" },
  },
  {
    files: ["tests/**"],
    rules: { "no-magic-numbers": "off", "max-lines-per-function": "off" },
  },
];
