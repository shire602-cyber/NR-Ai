import type { SiteLocale } from "../routes";

/**
 * Labels for the pause/play controls of the hero loop and the product tour. Kept as a small keyed
 * bilingual const (not in the catalog) so the controls cost no extra catalog load.
 */
export interface MotionLabels {
  heroPause: string;
  heroPlay: string;
  tourPause: string;
  tourPlay: string;
}

export const MOTION_LABELS: Record<SiteLocale, MotionLabels> = {
  en: {
    heroPause: "Pause animation",
    heroPlay: "Play animation",
    tourPause: "Pause tour",
    tourPlay: "Play tour",
  },
  ar: {
    heroPause: "إيقاف مؤقت للحركة",
    heroPlay: "تشغيل الحركة",
    tourPause: "إيقاف الجولة مؤقتًا",
    tourPlay: "تشغيل الجولة",
  },
};
