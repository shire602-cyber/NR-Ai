import { useMemo } from "react";
import { Check, FileText, Eye } from "lucide-react";
import { money, reconcileBank } from "./model";
import { BANK_FILE_NAME, BANK_ROWS } from "./sample";
import { useAutoStart, useSequence } from "./sequence";
import { Sample, type TabProps } from "./shared";

export default function BankTab({ text, reduced, autoPlay }: TabProps) {
  const results = useMemo(() => reconcileBank(), []);
  const seq = useSequence(BANK_ROWS.length, 650, reduced);
  useAutoStart(autoPlay, seq.start, 700);
  const matched = results.filter((r) => r.ref !== null).length;
  const review = results.length - matched;

  return (
    <div className="mz-tour-bank">
      <div className="mz-tour-bank-head">
        <span className="mz-tour-chip" aria-label={text("hxTourCsvFile")}>
          <FileText aria-hidden="true" />
          <Sample lang="en">{BANK_FILE_NAME}</Sample>
          <span className="mz-tour-chip-meta">
            {text("hxTourCsvLines", { count: BANK_ROWS.length })}
          </span>
        </span>
        <div className="mz-tour-actions">
          <button
            type="button"
            className="phase-primary"
            data-testid="tour-match"
            disabled={seq.running}
            onClick={seq.start}
          >
            {seq.running ? text("hxTourMatching") : text("hxTourMatch")}
          </button>
          {seq.step > 0 && !seq.running && (
            <button type="button" className="mz-tour-link" onClick={seq.reset}>
              {text("hxTourReset")}
            </button>
          )}
        </div>
      </div>

      <div className="mz-tour-scroll">
        <table className="mz-tour-bank-table" data-testid="tour-bank-table">
          <thead>
            <tr>
              <th scope="col">{text("hxTourColDate")}</th>
              <th scope="col">{text("hxTourColDesc")}</th>
              <th scope="col">
                {text("hxTourColAmount")} ({text("hxTourCurrency")})
              </th>
              <th scope="col">{text("hxTourColMatch")}</th>
              <th scope="col">{text("hxTourColStatus")}</th>
            </tr>
          </thead>
          <tbody>
            {BANK_ROWS.map((row, i) => {
              const result = results[i];
              const decided = seq.step > i;
              const isReview = decided && result.ref === null;
              const state = !decided ? "waiting" : isReview ? "review" : "matched";
              return (
                <tr key={row.id} data-state={state}>
                  <td>
                    <span className="mz-tour-num" dir="ltr" translate="no">
                      {row.date}
                    </span>
                  </td>
                  <td>
                    <Sample lang="en">{row.text}</Sample>
                  </td>
                  <td>
                    <span className="mz-tour-num" dir="ltr" translate="no">
                      {money(row.amountFils)}
                    </span>
                  </td>
                  <td>
                    {decided && result.ref !== null && (
                      <Sample>
                        {text(
                          result.kind === "sale" ? "hxTourMatchInvoice" : "hxTourMatchExpense",
                          {
                            ref: result.ref,
                          }
                        )}
                      </Sample>
                    )}
                  </td>
                  <td>
                    <span className={`mz-tour-state mz-tour-state--${state}`}>
                      {state === "matched" && <Check aria-hidden="true" />}
                      {state === "review" && <Eye aria-hidden="true" />}
                      {text(
                        state === "matched"
                          ? "hxTourStMatched"
                          : state === "review"
                            ? "hxTourStReview"
                            : "hxTourStWaiting"
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mz-tour-done" aria-live="polite" role="status" data-testid="tour-bank-summary">
        {seq.done && text("hxTourReconSummary", { matched, total: results.length, review })}
      </p>
    </div>
  );
}
