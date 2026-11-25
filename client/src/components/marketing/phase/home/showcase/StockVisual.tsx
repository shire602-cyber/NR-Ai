import { Num, VisualFrame, stagger, type VisualProps } from "./frame";
import { STOCK_ITEMS, STOCK_LABELS, STOCK_SERIES, pick } from "./sample";

/** Two separate number series, and a stock table that keeps its own value. */
export default function StockVisual({ locale, text, label }: VisualProps) {
  return (
    <VisualFrame text={text} label={label}>
      {() => (
        <div className="mz-show-stockwrap" lang={locale}>
          <div className="mz-show-pair">
            {STOCK_SERIES.map((series, s) => (
              <div className="mz-show-paper mz-show-series" key={series.id}>
                <p className="mz-show-paper-title">{pick(series.label, locale)}</p>
                <ul className="mz-show-numbers" dir="ltr">
                  {series.numbers.map((n, i) => (
                    <li className="mz-show-chip mz-show-anim" style={stagger(s + i)} key={n}>
                      {n}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mz-show-paper">
            <table className="mz-show-table">
              <thead>
                <tr>
                  <th scope="col">{pick(STOCK_LABELS.item, locale)}</th>
                  <th scope="col">{pick(STOCK_LABELS.onHand, locale)}</th>
                  <th scope="col">{pick(STOCK_LABELS.value, locale)}</th>
                </tr>
              </thead>
              <tbody>
                {STOCK_ITEMS.map((item, i) => (
                  <tr className="mz-show-anim" style={stagger(i + 4)} key={item.id}>
                    <td>{pick(item.name, locale)}</td>
                    <td dir="ltr">{item.qty}</td>
                    <td>
                      <Num fils={item.valueFils} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </VisualFrame>
  );
}
