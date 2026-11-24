import { useAmbientMotion, useAppSurface } from "@/lib/motion/useAmbientMotion";

/**
 * Mounted once by each signed-in shell (app, portal). Renders nothing: it switches the document
 * to the app design tokens and lazily starts pointer tilt / parallax when motion is allowed.
 */
export function AppSurface() {
  useAppSurface();
  useAmbientMotion();
  return null;
}
