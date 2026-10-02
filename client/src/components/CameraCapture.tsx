import { useRef, useState } from "react";
import { Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { downscaleImage } from "@/lib/image-downscale";
import { messages as pageMessages } from "./CameraCapture.i18n";

interface Props {
  /** Receives the downscaled photo(s). */
  onCapture: (files: File[]) => void | Promise<void>;
  disabled?: boolean;
  className?: string;
  /** A small inline button instead of the full-width one. */
  compact?: boolean;
}

/**
 * Opens the phone's camera (rear camera by default) and hands back a smaller
 * JPEG. On a desktop-size screen it renders nothing: the normal file picker
 * already covers that case.
 */
export function CameraCapture({ onCapture, disabled, className, compact = false }: Props) {
  const tr = pageMessages.useT();
  const isMobile = useIsMobile();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!isMobile) return null;

  async function handle(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setFailed(false);
    try {
      const prepared = await Promise.all(Array.from(files).map((f) => downscaleImage(f)));
      await onCapture(prepared);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className={className}>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-label={tr("takePhoto")}
        onChange={(e) => void handle(e.target.files)}
        data-testid="input-camera"
      />
      <Button
        type="button"
        size={compact ? "sm" : "lg"}
        variant={compact ? "outline" : "default"}
        className={compact ? "min-h-[36px]" : "min-h-[44px] w-full"}
        disabled={disabled || busy}
        onClick={(event) => {
          event.stopPropagation();
          input.current?.click();
        }}
        data-testid="button-take-photo"
      >
        <Camera className={compact ? "me-2 h-4 w-4" : "me-2 h-5 w-5"} aria-hidden="true" />
        {busy ? tr("processing") : tr("takePhoto")}
      </Button>
      {failed && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {tr("failed")}
        </p>
      )}
    </div>
  );
}
