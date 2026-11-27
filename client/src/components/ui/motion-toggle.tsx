import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useMotionPreference } from "@/lib/motion/preference";
import { useTranslation } from "@/lib/i18n";

/**
 * Top-bar control that pauses or resumes decorative motion (tilt, parallax, entrance and
 * hover animation). When the operating system asks for reduced motion it shows the paused
 * state and cannot resume.
 */
export function MotionToggle({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { paused, systemReduced, toggle } = useMotionPreference();
  const off = paused || systemReduced;
  const Icon = off ? Play : Pause;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={cn("text-muted-foreground hover:text-foreground", className)}
      onClick={systemReduced ? undefined : toggle}
      aria-pressed={off}
      aria-disabled={systemReduced || undefined}
      aria-label={t["shell.motionPause"]}
      title={systemReduced ? t["shell.motionSystemReduced"] : t["shell.motionPause"]}
      data-testid="button-motion-toggle"
    >
      <Icon aria-hidden className="rtl:-scale-x-100" />
    </Button>
  );
}
