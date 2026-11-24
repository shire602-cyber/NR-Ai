import { useAmbientMotion } from "@/lib/motion/useAmbientMotion";
import { useAppSurface } from "@/lib/motion/surface";

/**
 * Mounted once by the signed-in app shell (the portal calls the hooks itself). Renders nothing: it switches the document
 * to the app design tokens and lazily starts pointer tilt / parallax when motion is allowed.
 */
export function AppSurface() {
  useAppSurface();
  useAmbientMotion();
  return null;
}
