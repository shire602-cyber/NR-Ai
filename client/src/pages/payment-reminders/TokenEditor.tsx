import { useCallback, useEffect, useRef } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";
import { splitMessage, tokenText, type TokenField, type TokenSyntax } from "./tokens";

export type { TokenField, TokenSyntax } from "./tokens";

/**
 * Message text with merge fields shown as chips ("Customer name"), never as braces
 * (spec 3.7). The stored value keeps the server's placeholder syntax — `{customerName}`
 * for payment-reminder templates, `{{customerName}}` for automatic reminder emails — so
 * nothing the server renders changes; only the editing surface does.
 */

const CHIP_CLASS =
  "mx-0.5 inline-flex items-center rounded-full border border-border bg-secondary px-2 py-px align-baseline text-caption font-medium text-foreground";

/** Read-only rendering: the message as the customer will read it, fields as chips. */
export function MessageWithChips({
  value,
  syntax,
  fields,
  className,
  dir,
  lang,
}: {
  value: string;
  syntax: TokenSyntax;
  fields: TokenField[];
  className?: string;
  dir?: "ltr" | "rtl" | "auto";
  /** Language of the message itself (a reminder in English stays English in the Arabic UI). */
  lang?: "en" | "ar";
}) {
  const { locale } = useTranslation();
  const labelOf = (key: string) => fields.find((f) => f.key === key)?.label ?? key;
  return (
    <p className={cn("whitespace-pre-wrap text-small leading-6", className)} dir={dir} lang={lang}>
      {splitMessage(value, syntax).map((part, i) =>
        part.kind === "text" ? (
          <span key={i}>{part.text}</span>
        ) : (
          // The field chip is a UI label, in the UI language.
          <span key={i} className={CHIP_CLASS} lang={lang && lang !== locale ? locale : undefined}>
            {labelOf(part.key)}
          </span>
        )
      )}
    </p>
  );
}

function renderInto(el: HTMLElement, value: string, syntax: TokenSyntax, fields: TokenField[]) {
  el.replaceChildren();
  for (const part of splitMessage(value, syntax)) {
    if (part.kind === "text") {
      el.append(document.createTextNode(part.text));
    } else {
      el.append(chipNode(part.key, fields));
    }
  }
}

function chipNode(key: string, fields: TokenField[]): HTMLElement {
  const chip = document.createElement("span");
  chip.contentEditable = "false";
  chip.dataset.token = key;
  chip.className = CHIP_CLASS;
  chip.textContent = fields.find((f) => f.key === key)?.label ?? key;
  return chip;
}

/** Walks the editable DOM back into the stored placeholder syntax. */
function serialize(el: HTMLElement, syntax: TokenSyntax): string {
  let out = "";
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? "";
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.dataset.token) {
      out += tokenText(node.dataset.token, syntax);
      return;
    }
    if (node.tagName === "BR") {
      out += "\n";
      return;
    }
    const block = node !== el && (node.tagName === "DIV" || node.tagName === "P");
    if (block && out && !out.endsWith("\n")) out += "\n";
    node.childNodes.forEach(walk);
  };
  el.childNodes.forEach(walk);
  return out;
}

export function TokenEditor({
  value,
  onChange,
  syntax,
  fields,
  insertLabel,
  dir,
  multiline = true,
  id,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  testId,
}: {
  value: string;
  onChange: (value: string) => void;
  syntax: TokenSyntax;
  fields: TokenField[];
  insertLabel: string;
  dir?: "ltr" | "rtl";
  multiline?: boolean;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef<string | null>(null);
  const savedRange = useRef<Range | null>(null);

  // Re-render the DOM only when the value changes from outside (not while typing).
  useEffect(() => {
    const el = ref.current;
    if (!el || value === lastEmitted.current) return;
    renderInto(el, value, syntax, fields);
    lastEmitted.current = value;
  }, [value, syntax, fields]);

  const emit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const next = serialize(el, syntax);
    lastEmitted.current = next;
    onChange(next);
  }, [onChange, syntax]);

  const rememberCaret = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && ref.current?.contains(sel.anchorNode)) {
      savedRange.current = sel.getRangeAt(0).cloneRange();
    }
  };

  const insert = (key: string) => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    let range = savedRange.current;
    if (!range || !el.contains(range.startContainer)) {
      range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
    }
    range.deleteContents();
    const chip = chipNode(key, fields);
    const space = document.createTextNode(" ");
    range.insertNode(space);
    range.insertNode(chip);
    range.setStartAfter(space);
    range.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(range);
    savedRange.current = range.cloneRange();
    emit();
  };

  return (
    <div className="rounded-md border border-input bg-card shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/20">
      <div
        ref={ref}
        id={id}
        role="textbox"
        aria-multiline={multiline}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        contentEditable
        suppressContentEditableWarning
        dir={dir}
        data-testid={testId}
        className={cn(
          "whitespace-pre-wrap px-3 py-2 text-small leading-6 text-foreground outline-none",
          multiline ? "min-h-40" : "min-h-9"
        )}
        onInput={emit}
        onKeyUp={rememberCaret}
        onMouseUp={rememberCaret}
        onBlur={rememberCaret}
        onKeyDown={(e) => {
          if (!multiline && e.key === "Enter") e.preventDefault();
        }}
        onPaste={(e) => {
          // Paste as plain text so no foreign markup lands in a customer message.
          e.preventDefault();
          const text = e.clipboardData.getData("text/plain");
          document.execCommand("insertText", false, multiline ? text : text.replace(/\s+/g, " "));
        }}
      />
      <div className="flex justify-end border-t border-border px-2 py-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="sm" onMouseDown={rememberCaret}>
              <Plus aria-hidden />
              {insertLabel}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            {fields.map((f) => (
              <DropdownMenuItem key={f.key} onSelect={() => insert(f.key)}>
                {f.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
