import { Download } from "lucide-react";
import { Num, VisualFrame, stagger, type VisualProps } from "./frame";
import { PAYROLL_EMPLOYEES, PAYROLL_LABELS, pick } from "./sample";

const TOTAL_FILS = PAYROLL_EMPLOYEES.reduce((sum, e) => sum + e.netFils, 0);

/** A payroll run turns into the WPS SIF file: one employee record each, then a control record. */
export default function PayrollVisual({ locale, text, label }: VisualProps) {
  return (
    <VisualFrame text={text} label={label}>
      {() => (
        <div className="mz-show-split" lang={locale}>
          <div className="mz-show-paper">
            <p className="mz-show-paper-title">{pick(PAYROLL_LABELS.run, locale)}</p>
            <table className="mz-show-table">
              <thead>
                <tr>
                  <th scope="col">{pick(PAYROLL_LABELS.employee, locale)}</th>
                  <th scope="col">{pick(PAYROLL_LABELS.net, locale)}</th>
                </tr>
              </thead>
              <tbody>
                {PAYROLL_EMPLOYEES.map((e) => (
                  <tr key={e.id}>
                    <td>{pick(e.name, locale)}</td>
                    <td>
                      <Num fils={e.netFils} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mz-show-paper mz-show-sif">
            <p className="mz-show-paper-title">{pick(PAYROLL_LABELS.file, locale)}</p>
            <ul className="mz-show-lines">
              {PAYROLL_EMPLOYEES.map((e, i) => (
                <li className="mz-show-anim" style={stagger(i)} key={e.id}>
                  <span>
                    <code dir="ltr">EDR</code> {pick(PAYROLL_LABELS.edr, locale)}
                  </span>
                  <Num fils={e.netFils} />
                </li>
              ))}
              <li className="mz-show-anim" style={stagger(PAYROLL_EMPLOYEES.length)}>
                <span>
                  <code dir="ltr">SCR</code> {pick(PAYROLL_LABELS.scr, locale)}
                </span>
                <Num fils={TOTAL_FILS} />
              </li>
            </ul>
            <p className="mz-show-anim" style={stagger(PAYROLL_EMPLOYEES.length + 1)}>
              <span className="mz-show-chip mz-show-chip--ok">
                <Download aria-hidden="true" /> {pick(PAYROLL_LABELS.ready, locale)}
              </span>
            </p>
          </div>
        </div>
      )}
    </VisualFrame>
  );
}
