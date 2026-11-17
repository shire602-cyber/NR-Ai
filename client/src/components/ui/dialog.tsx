"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { T } from "@/components/layout/T";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-neutral-950/45 backdrop-blur-[2px] dark:bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

/**
 * Dialog sizes (WP-A, Fable spec 2.2): `sm` 480 (simple / confirm), `md` 640 (forms),
 * `lg` 880 (two-pane). `xl` is kept for old call sites only — anything with line items is an
 * EditorShell page, not a dialog. Below 640px a sized dialog is a sheet: full screen for
 * md/lg/xl, a bottom sheet for sm; the DialogFooter is sticky at the bottom edge with the
 * primary at the inline end. Without `size` the legacy centred panel is kept (480).
 * Motion (spec 2.5): scale 0.98 → 1 + fade, 180 ms.
 */
export type DialogSize = "sm" | "md" | "lg" | "xl";
const DIALOG_SIZE_CLASS: Record<DialogSize, string> = {
  sm: "sm:max-w-[30rem]",
  md: "sm:max-w-[40rem]",
  lg: "sm:max-w-[55rem]",
  xl: "sm:max-w-6xl",
};
const LEGACY_PANEL =
  "left-[50%] top-[50%] grid w-[calc(100%-2rem)] max-w-[30rem] max-h-[calc(100dvh-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-xl border p-6 data-[state=closed]:zoom-out-[0.98] data-[state=open]:zoom-in-[0.98]";
/** Sized dialogs: the footer sticks to the bottom edge of the scrolling panel. */
const STICKY_FOOTER =
  "[&_[data-dialog-footer]]:sticky [&_[data-dialog-footer]]:bottom-0 [&_[data-dialog-footer]]:z-10 [&_[data-dialog-footer]]:-mx-4 [&_[data-dialog-footer]]:-mb-5 [&_[data-dialog-footer]]:mt-auto [&_[data-dialog-footer]]:border-t [&_[data-dialog-footer]]:border-border [&_[data-dialog-footer]]:bg-card [&_[data-dialog-footer]]:px-4 [&_[data-dialog-footer]]:py-3 sm:[&_[data-dialog-footer]]:-mx-6 sm:[&_[data-dialog-footer]]:-mb-6 sm:[&_[data-dialog-footer]]:px-6";
/** Shared from 640px: a centred panel. Below it, the form fills the sheet and its actions sit at the bottom. */
const SIZED_PANEL =
  "flex w-full flex-col gap-4 px-4 pb-5 pt-5 max-sm:[&>form]:flex max-sm:[&>form]:flex-1 max-sm:[&>form]:flex-col data-[state=open]:slide-in-from-bottom-6 data-[state=closed]:slide-out-to-bottom-6 sm:inset-auto sm:left-[50%] sm:top-[50%] sm:h-auto sm:max-h-[calc(100dvh-4rem)] sm:w-[calc(100%-2rem)] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-xl sm:border sm:px-6 sm:pb-6 sm:pt-6 sm:data-[state=open]:slide-in-from-bottom-2 sm:data-[state=closed]:slide-out-to-bottom-2";
/** Below 640px: md/lg/xl are full-screen sheets; sm is a bottom sheet that grows with its content. */
const MOBILE_FULL = "inset-0 h-[100dvh] max-h-[100dvh] rounded-none border-0";
const MOBILE_BOTTOM =
  "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-2xl border-x-0 border-b-0 border-t";

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { size?: DialogSize }
>(({ className, children, size, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      data-size={size}
      className={cn(
        "fixed z-50 overflow-y-auto overscroll-contain border-popover-border bg-card text-card-foreground shadow-xl duration-[180ms] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none",
        size
          ? cn(
              size === "sm" ? MOBILE_BOTTOM : MOBILE_FULL,
              SIZED_PANEL,
              DIALOG_SIZE_CLASS[size],
              STICKY_FOOTER
            )
          : LEGACY_PANEL,
        className
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute end-3 top-3 flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground ring-offset-background transition-colors duration-fast hover:bg-secondary hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none data-[state=open]:bg-secondary data-[state=open]:text-muted-foreground sm:h-8 sm:w-8">
        <X className="h-4 w-4" />
        <span className="sr-only">
          <T k="components.close" />
        </span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col gap-1.5 pe-8 text-start", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    data-dialog-footer=""
    className={cn("flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end", className)}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-h2 font-semibold text-foreground", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-small text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
