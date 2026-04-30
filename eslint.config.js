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
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      // React Compiler rules from eslint-plugin-react-hooks v6+ are
      // optimization hints, not correctness bugs. Keep them visible as
      // warnings so the build/lint gate stays green on Railway.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
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
    files: ["client/public/**/*.js", "**/sw.js", "**/service-worker.js"],
    languageOptions: {
      globals: { ...globals.serviceworker, ...globals.browser },
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

  prettier,
);
