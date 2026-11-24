import { ArrowRight } from "lucide-react";
import { useCountUp } from "../motion";
import { vat201Boxes } from "../tour/model";
import { Num, VisualFrame, stagger, type MotionState, type VisualProps } from "./frame";
import { VAT_BOX_LABELS, VAT_HEADINGS, pick } from "./sample";

const BOXES = vat201Boxes();
const ROWS = ["box1b", "box4", "box8", "box9"] as const;

function Payable({ locale, state }: { locale: VisualProps["locale"]; state: MotionState }) {
  const fils = Math.round(useCountUp(BOXES.box14.vatFils, { enabled: state !== "idle" }));
  return (
    <p className="mz-show-linemz-show-strong mz-show-anim" style={stagger(ROWS.length + 1)}>
      <span>{pick(VAT_BOX_LABELS.box14, locale)}</span>
      <Num fils={fils} className="mz-show-payable" />
    </p>
  );
}

/** VAT 201 boxes fill from the same sample transactions the tour uses. */
export default function VatVisual({ locale, text, label }: VisualProps) {
  return (
    <VisualFrame text={text} label={label}>
      {(state) => (
        <div className="mz-show-paper mz-show-vat" lang={locale}>
          <p className="mz-show-linemz-show-muted">
            <span>{pick(VAT_HEADINGS.period, locale)}</span>
            <span className="mz-show-cols">
              <span>{pick(VAT_HEADINGS.amount, locale)}</span>
              <span>{pick(VAT_HEADINGS.vat, locale)}</span>
            </span>
          </p>
          {ROWS.map((key, i) => (
            <p className="mz-show-linemz-show-anim mz-show-box" style={stagger(i)} key={key}>
              <span>{pick(VAT_BOX_LABELS[key], locale)}</span>
              <span className="mz-show-cols">
                <Num fils={BOXES[key].amountFils} />
                <Num fils={BOXES[key].vatFils} />
              </span>
            </p>
          ))}
          <Payable locale={locale} state={state} />
          <p className="mz-show-steps mz-show-anim" style={stagger(ROWS.length + 2)}>
            <span className="mz-show-chip">{pick(VAT_HEADINGS.review, locale)}</span>
            <ArrowRight className="mz-show-flip" aria-hidden="true" />
            <span className="mz-show-chip mz-show-chip--ok">
              {pick(VAT_HEADINGS.submit, locale)}
            </span>
          </p>
        </div>
      )}
    </VisualFrame>
  );
}
