import type { ReactNode } from "react";

/** Eyebrow + h2 + lead shared by the homepage sections (styles: `.mz-head`, `.mz-h2`, `.mz-lead`). */
export function SectionHead({
  eyebrow,
  title,
  lead,
  id,
}: {
  eyebrow?: string;
  title: string;
  lead?: ReactNode;
  id?: string;
}) {
  return (
    <header className="mz-head">
      {eyebrow && <p className="mz-eyebrow">{eyebrow}</p>}
      <h2 className="mz-h2" id={id}>
        {title}
      </h2>
      {lead && <p className="mz-lead">{lead}</p>}
    </header>
  );
}
