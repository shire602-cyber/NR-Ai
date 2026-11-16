import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "build/**",
      "coverage/**",
      "migrations/**",
      "uploads/**",
      "**/*.d.ts",
      "package-lock.json",
      ".claude/**",
      ".claire/**",
      // Vendored side projects and audit evidence — not product code.
      // They were contributing 361 lint errors that drowned real signal.
      "sites/**",
      "docs/archive/**",
      "najma-raeda-logo/**",
      "node_modules.*/**",
      "brand/**",
      "tools/**",
      "extensions/**",
      "tmp/**",
      "outputs/**",
      ".codex-artifacts/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-namespace": ["error", { allowDeclarations: true }],
      "@typescript-eslint/ban-ts-comment": "warn",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-useless-escape": "warn",
      "prefer-const": "warn",
    },
  },

  {
    files: ["client/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        {
          allowConstantExport: true,
          // Deliberate non-component exports that sit next to their component:
          // shadcn/ui cva variants and context hooks, and framer-motion variants.
          allowExportNames: [
            "badgeVariants",
            "buttonVariants",
            "toggleVariants",
            "useFormField",
            "useSidebar",
            "useActiveCompany",
            "useRTL",
            "fadeInUp",
            "fadeInDown",
            "fadeInLeft",
            "fadeInRight",
            "scaleIn",
            "staggerContainer",
            "staggerItem",
            "hoverScale",
            "hoverLift",
          ],
        },
      ],
      // React Compiler rules from eslint-plugin-react-hooks v6+. The lint gate
      // runs with --max-warnings 0, so keep these at "warn" and fix (or
      // justify with an inline disable) every hit.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
      // The React Compiler is not enabled (vite.config.ts uses plain
      // @vitejs/plugin-react), so these two rules only explain why the
      // compiler would skip a component (react-hook-form watch(),
      // @tanstack/react-virtual, manual memoization); they report no bug in
      // the code as it runs today. Re-enable them together with the compiler.
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/incompatible-library": "off",
      "react-hooks/use-memo": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
    },
  },

  {
    files: ["server/**/*.ts", "shared/**/*.ts", "tests/**/*.ts", "drizzle.config.ts"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  {
    // Server and shared code are fully typed: use real types, `unknown` plus
    // narrowing, or a typed boundary helper instead of `any`.
    files: ["server/**/*.ts", "shared/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },

  {
    files: ["scripts/**/*.mjs", "*.config.js", "*.config.mjs"],
    languageOptions: {
      globals: { ...globals.node, fetch: "readonly" },
    },
  },

  {
    // Plain-JS scripts and live-server test harnesses use intentional
    // empty catches (`try { json = JSON.parse(t) } catch {}`) — allow them,
    // matching the TS rule above.
    files: ["**/*.mjs"],
    rules: {
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },

  {
    files: ["client/public/**/*.js", "**/sw.js", "**/service-worker.js"],
    languageOptions: {
      globals: { ...globals.serviceworker, ...globals.browser },
    },
  },

  {
    // Browser-extension scripts: chrome.* APIs plus page DOM.
    files: ["extensions/**/*.js"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.webextensions },
    },
  },

  {
    // E2E crawler runs under Node but its page.evaluate callbacks execute in
    // the browser, so both global sets apply.
    files: ["tests/**/*.mjs"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },

  {
    files: ["**/*.test.ts", "**/*.spec.ts", "tests/**/*.ts"],
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
    },
    rules: {
      "@typescript-eslint/no-unused-expressions": "off",
    },
  },

  prettier
);
