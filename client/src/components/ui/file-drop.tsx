import * as React from "react";
import { FileText, Upload, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface FileDropProps {
  /** Called with the chosen / dropped files (already filtered to `multiple`). */
  onFiles: (files: File[]) => void;
  /** Same as the native input's `accept`, e.g. ".csv,.xlsx" or "image/*". */
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  /** Visible line, e.g. "Drop a CSV or Excel file". Defaults to "Drop a file here". */
  label?: React.ReactNode;
  /** Muted line under the label, e.g. "CSV, XLSX · up to 10 MB". */
  hint?: React.ReactNode;
  /** The currently selected file name(s), shown instead of the prompt. */
  value?: string | string[] | null;
  /** Shows a remove button when a file is selected. */
  onClear?: () => void;
  /** id of the hidden <input type="file"> (pair with a <Label htmlFor>). */
  id?: string;
  name?: string;
  className?: string;
  /** data-testid of the row. */
  testId?: string;
  /** data-testid kept on the hidden file input (tests call setInputFiles on it). */
  inputTestId?: string;
  "aria-describedby"?: string;
}

/**
 * FileDrop (spec G2) — replaces the native "Choose File · No file chosen" control. A hairline
 * dashed row with an icon, a prompt and a "Choose file" button; drag-and-drop works on
 * desktop. The real `<input type="file">` stays in the DOM (visually hidden) so labels,
 * forms and Playwright `setInputFiles` keep working.
 */
export const FileDrop = React.forwardRef<HTMLInputElement, FileDropProps>(
  (
    {
      onFiles,
      accept,
      multiple = false,
      disabled = false,
      label,
      hint,
      value,
      onClear,
      id,
      name,
      className,
      testId,
      inputTestId,
      "aria-describedby": ariaDescribedBy,
    },
    ref
  ) => {
    const { t } = useTranslation();
    const generatedId = React.useId();
    const inputId = id ?? `file-drop-${generatedId}`;
    const inputRef = React.useRef<HTMLInputElement | null>(null);
    const [dragging, setDragging] = React.useState(false);
    const names = value == null ? [] : Array.isArray(value) ? value : [value];
    const hasFile = names.length > 0 && names.some(Boolean);

    const emit = (list: FileList | null) => {
      if (!list || list.length === 0) return;
      const files = Array.from(list);
      onFiles(multiple ? files : files.slice(0, 1));
    };

    return (
      <div
        data-testid={testId ?? "file-drop"}
        data-dragging={dragging || undefined}
        className={cn(
          "flex min-h-14 w-full flex-wrap items-center gap-3 rounded-lg border border-dashed border-border-strong bg-card px-4 py-3 transition-colors duration-fast",
          dragging && "border-primary bg-brand-50 dark:bg-brand-950/40",
          disabled && "pointer-events-none opacity-60",
          className
        )}
        onDragOver={(e) => {
          if (disabled) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (disabled) return;
          e.preventDefault();
          setDragging(false);
          emit(e.dataTransfer.files);
        }}
      >
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
          aria-hidden
        >
          {hasFile ? <FileText className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1 text-small">
          {hasFile ? (
            <div className="truncate font-medium text-foreground" dir="auto">
              {names.filter(Boolean).join(", ")}
            </div>
          ) : (
            <div className="text-foreground">{label ?? t["components.ui.fileDropPrompt"]}</div>
          )}
          {hint ? (
            <div className="text-caption font-normal text-muted-foreground">{hint}</div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {hasFile && onClear ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                if (inputRef.current) inputRef.current.value = "";
                onClear();
              }}
              aria-label={t["components.ui.fileDropRemove"]}
              title={t["components.ui.fileDropRemove"]}
            >
              <X aria-hidden />
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
            aria-controls={inputId}
          >
            {hasFile ? t["components.ui.fileDropReplace"] : t["components.ui.fileDropChoose"]}
          </Button>
        </div>
        <input
          ref={(node) => {
            inputRef.current = node;
            if (typeof ref === "function") ref(node);
            else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = node;
          }}
          id={inputId}
          name={name}
          type="file"
          className="sr-only"
          tabIndex={-1}
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          aria-describedby={ariaDescribedBy}
          // Without an external <Label htmlFor={id}>, the input still needs a name (axe `label`).
          aria-label={
            id ? undefined : typeof label === "string" ? label : t["components.ui.fileDropPrompt"]
          }
          data-testid={inputTestId}
          onChange={(e) => emit(e.target.files)}
        />
      </div>
    );
  }
);
FileDrop.displayName = "FileDrop";
