import { Fragment, type ReactNode } from "react";
import { Link } from "wouter";
import { parseBlocks, type Block, type Inline } from "@/lib/help/markdown-lite";

function renderInline(nodes: Inline[]): ReactNode {
  return nodes.map((n, i) => {
    switch (n.t) {
      case "text":
        return <Fragment key={i}>{n.v}</Fragment>;
      case "strong":
        return <strong key={i}>{renderInline(n.c)}</strong>;
      case "em":
        return <em key={i}>{renderInline(n.c)}</em>;
      case "code":
        return (
          <code key={i} dir="ltr" className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">
            {n.v}
          </code>
        );
      case "link":
        return n.internal ? (
          <Link key={i} href={n.href} className="text-primary underline underline-offset-2">
            {renderInline(n.c)}
          </Link>
        ) : (
          <a key={i} href={n.href} rel="noopener noreferrer" target="_blank" className="text-primary underline underline-offset-2">
            {renderInline(n.c)}
          </a>
        );
    }
  });
}

function renderBlock(b: Block, i: number): ReactNode {
  switch (b.t) {
    case "h2":
      return (
        <h2 key={i} id={b.id} className="mt-8 scroll-mt-20 text-xl font-semibold">
          {renderInline(b.c)}
        </h2>
      );
    case "h3":
      return (
        <h3 key={i} id={b.id} className="mt-6 scroll-mt-20 text-base font-semibold">
          {renderInline(b.c)}
        </h3>
      );
    case "p":
      return (
        <p key={i} className="mt-3 leading-7">
          {renderInline(b.c)}
        </p>
      );
    case "ul":
      return (
        <ul key={i} className="mt-3 list-disc space-y-1.5 ps-6 leading-7">
          {b.items.map((item, j) => (
            <li key={j}>{renderInline(item)}</li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol key={i} className="mt-3 list-decimal space-y-1.5 ps-6 leading-7">
          {b.items.map((item, j) => (
            <li key={j}>{renderInline(item)}</li>
          ))}
        </ol>
      );
    case "quote":
      return (
        <blockquote key={i} className="mt-4 rounded-md border-s-4 border-primary/50 bg-muted/40 px-4 py-3 text-sm leading-6">
          {renderInline(b.c)}
        </blockquote>
      );
    case "code":
      return (
        <pre key={i} dir="ltr" className="mt-3 overflow-x-auto rounded-md bg-muted p-3 text-xs leading-5">
          {b.v}
        </pre>
      );
  }
}

/** Renders help markdown as React elements. No HTML string is ever built from article text. */
export function MarkdownView({ source }: { source: string }) {
  return <div data-testid="markdown-view">{parseBlocks(source).map(renderBlock)}</div>;
}
