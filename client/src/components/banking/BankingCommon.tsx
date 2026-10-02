import { messages } from "./BankingCommon.i18n";
import { confidenceText, confidenceTone, type ConfidenceTone } from "./banking-common";

const TONE_CLASS: Record<ConfidenceTone, string> = {
  success: "text-[hsl(var(--chart-5))]",
  warning: "text-[hsl(var(--chart-4))]",
  danger: "text-destructive",
};

/** "95% - High": the score and its band, coloured by band. Shared by every banking screen that ranks matches. */
export function ConfidenceLabel({ score, className = "" }: { score: number; className?: string }) {
  const trc = messages.useT();
  return (
    <span className={`font-medium ${TONE_CLASS[confidenceTone(score)]} ${className}`} data-confidence={score}>
      <span dir="ltr">{score}%</span> {confidenceText(trc, score)}
    </span>
  );
}
