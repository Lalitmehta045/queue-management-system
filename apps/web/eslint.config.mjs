import { FlatCompat } from "@eslint/eslintrc";
import nextPlugin from "@next/eslint-plugin-next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname
});

export default [
  {
    ignores: [
      ".next",
      "node_modules",
      "dist",
      "eslint.config.mjs",
      "next-env.d.ts",
      "next.config.ts",
      "postcss.config.js",
      "tailwind.config.ts"
    ]
  },
  {
    plugins: {
      "@next/next": nextPlugin
    }
  },
  ...compat.extends("next/core-web-vitals", "next/typescript")
];
