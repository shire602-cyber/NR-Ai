import { MotionToggle } from "@/components/ui/motion-toggle";
import { useAmbientMotion } from "@/lib/motion/useAmbientMotion";

/** Portal top bar: the motion pause control, plus the lazy pointer tilt / parallax loader. */
export default function PortalMotion() {
  useAmbientMotion();
  return <MotionToggle className="hidden sm:inline-flex" />;
}
