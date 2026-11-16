import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The design-system type scale (tailwind.config.ts fontSize) must be known to
// tailwind-merge as font sizes; otherwise `text-h1` and `text-muted-foreground` look
// like two text colours and merging drops the size (D3b).
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["display", "h1", "h2", "h3", "h4", "body", "small", "caption"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
