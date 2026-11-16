import type { ReactNode } from "react";
import { Check, type LucideIcon } from "lucide-react";

/*
 * Shared marketing section primitives for inner public pages (R3, CTO 8/9): the same
 * line-eyebrow heading, checklist and hairline tiles the landing page uses, so /services,
 * /trust and /help read as one system with the home page. Styles: marketing.css.
 */

export function SectionHeading({
  eyebrow,
  title,
  body,
  center,
  id,
}: {
  eyebrow?: string;
  title: string;
  body?: ReactNode;
  center?: boolean;
  id?: string;
}) {
  return (
    <div className={`mk-heading${center ? " mk-heading--center" : ""}`}>
      {eyebrow ? <p className="mk-eyebrow">{eyebrow}</p> : null}
      <h2 className="mk-h2" id={id}>
        {title}
      </h2>
      {body ? <p className="mk-lead">{body}</p> : null}
    </div>
  );
}

export function Checklist({ items }: { items: ReactNode[] }) {
  return (
    <ul className="mk-checklist">
      {items.map((item, i) => (
        <li key={i}>
          <Check aria-hidden="true" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export interface TileItem {
  key: string;
  icon?: LucideIcon;
  title: ReactNode;
  body: ReactNode;
  testId?: string;
}

/** Hairline tiles: icon, title, one paragraph. 2 or 3 columns from tablet up. */
export function Tiles({ items, columns = 3 }: { items: TileItem[]; columns?: 2 | 3 }) {
  return (
    <ul className="mk-tiles" data-columns={columns}>
      {items.map(({ key, icon: Icon, title, body, testId }) => (
        <li key={key} className="mk-tile" data-testid={testId}>
          {Icon ? (
            <span className="mk-feature__icon">
              <Icon aria-hidden="true" />
            </span>
          ) : null}
          <h3 className="mk-h3">{title}</h3>
          <p className="mk-body">{body}</p>
        </li>
      ))}
    </ul>
  );
}
