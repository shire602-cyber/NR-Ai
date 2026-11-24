import { useMemo, useState } from "react";
import { Check, Download } from "lucide-react";
import { MARKETING_BRAND } from "@shared/marketing-brand";
import { vat201Boxes, type Vat201Boxes } from "./model";
import { useAutoStart, useSequence } from "./sequence";
import { Money, type TabProps } from "./shared";

const ROWS = [
  { id: "1b", box: "box1b", key: "hxTourBox1b" },
  { id: "4", box: "box4", key: "hxTourBox4" },
  { id: "8", box: "box8", key: "hxTourBox8" },
  { id: "9", box: "box9", key: "hxTourBox9" },
  { id: "11", box: "box11", key: "hxTourBox11" },
  { id: "14", box: "box14", key: "hxTourBox14" },
] as const satisfies readonly { id: string; box: keyof Vat201Boxes; key: string }[];

export default function VatTab({ locale, text, reduced, autoPlay }: TabProps) {
  const boxes = useMemo(() => vat201Boxes(), []);
  const seq = useSequence(ROWS.length, 550, reduced);
  const [exported, setExported] = useState(false);
  useAutoStart(autoPlay, seq.start, 700);

  return (
    <div className="mz-tour-vat">
      <div className="mz-tour-bank-head">
        <span className="mz-badge">{text("hxTourVatPeriod")}</span>
        <div className="mz-tour-actions">
          <button
            type="button"
            className="phase-button phase-primary"
            data-testid="tour-vat-fill"
            disabled={seq.running}
            onClick={() => {
              setExported(false);
              seq.start();
            }}
          >
            {seq.running ? text("hxTourVatFilling") : text("hxTourVatFill")}
          </button>
          {seq.step > 0 && !seq.running && (
            <button
              type="button"
              className="mz-tour-link"
              onClick={() => {
                setExported(false);
                seq.reset();
              }}
            >
              {text("hxTourReset")}
            </button>
          )}
        </div>
      </div>

      <div className="mz-tour-scroll">
        <table className="mz-tour-vat-table" data-testid="tour-vat-table">
          <thead>
            <tr>
              <th scope="col">{text("hxTourVatBox")}</th>
              <th scope="col">{text("hxTourColDesc")}</th>
              <th scope="col">{text("hxTourVatAmount")}</th>
              <th scope="col">{text("hxTourVatTax")}</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row, i) => {
              const filled = seq.step > i;
              const figure = boxes[row.box];
              return (
                <tr key={row.id} data-filled={filled} data-box={row.id}>
                  <th scope="row">
                    <span className="mz-tour-num" dir="ltr">
                      {row.id}
                    </span>
                  </th>
                  <td>{text(row.key)}</td>
                  <td>
                    {row.id === "14" ? null : filled ? (
                      <Money fils={figure.amountFils} />
                    ) : (
                      <span className="mz-tour-bar" aria-hidden="true" />
                    )}
                  </td>
                  <td>
                    {filled ? (
                      <Money fils={figure.vatFils} />
                    ) : (
                      <span className="mz-tour-bar" aria-hidden="true" />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mz-tour-export">
        <button
          type="button"
          className="phase-outline"
          data-testid="tour-vat-export"
          disabled={!seq.done}
          onClick={() => setExported(true)}
        >
          <Download aria-hidden="true" /> {text("hxTourVatExport")}
        </button>
        <p className="mz-tour-note">
          {text("hxTourVatNote", { brand: MARKETING_BRAND.name[locale] })}
        </p>
      </div>
      <p className="mz-tour-done" aria-live="polite" role="status">
        {exported && (
          <>
            <Check aria-hidden="true" /> {text("hxTourVatPrepared")}
          </>
        )}
      </p>
    </div>
  );
}
