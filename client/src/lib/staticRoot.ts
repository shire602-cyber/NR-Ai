import type { ComponentType } from "react";

/**
 * The firm build (`FIRM_BUILD=1`, vite.config.ts) imports the signed-in app statically so its
 * code ships in the entry chunk; it hands the root component to main.tsx here. The main build
 * never registers one, and main.tsx then loads the root lazily as always.
 */
let staticRoot: ComponentType | null = null;

export function registerStaticRoot(root: ComponentType): void {
  staticRoot = root;
}

export function getStaticRoot(): ComponentType | null {
  return staticRoot;
}
