import { useState } from "react";
import { useLocation } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useKeyboardShortcuts, formatCombo } from "@/hooks/useKeyboardShortcuts";
import { messages as pageMessages } from "./ShortcutsHelp.i18n";

const getShortcuts = () => [
  {
    group: pageMessages.t("general"),
    items: [
      { combo: "mod+k", label: pageMessages.t("openCommandPalette") },
      { combo: "/", label: pageMessages.t("searchOpenCommandPalette") },
      { combo: "mod+shift+/", label: pageMessages.t("showKeyboardShortcuts") },
      { combo: "escape", label: pageMessages.t("closeDialogOrModal") },
    ],
  },
  {
    group: pageMessages.t("navigation"),
    items: [
      { combo: "g d", label: pageMessages.t("goToDashboard") },
      { combo: "g i", label: pageMessages.t("goToInvoices") },
      { combo: "g j", label: pageMessages.t("goToJournal") },
      { combo: "g r", label: pageMessages.t("goToReports") },
      { combo: "g c", label: pageMessages.t("goToContacts") },
    ],
  },
  {
    group: pageMessages.t("lists"),
    items: [
      { combo: "j", label: pageMessages.t("moveDown") },
      { combo: "k", label: pageMessages.t("moveUp") },
      { combo: "enter", label: pageMessages.t("openSelectedItem") },
    ],
  },
  {
    group: pageMessages.t("create"),
    items: [{ combo: "n", label: pageMessages.t("newInvoiceOnInvoicesPage") }],
  },
];

interface ShortcutsHelpProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShortcutsHelp({ open, onOpenChange }: ShortcutsHelpProps) {
  const tr = pageMessages.useT();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{tr("keyboardShortcuts")}</DialogTitle>
          <DialogDescription>{tr("speedUpNavigationWithTheseKeys")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-5 pt-2 max-h-[60vh] overflow-y-auto">
          {getShortcuts().map((section) => (
            <div key={section.group}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                {section.group}
              </h3>
              <div className="space-y-1">
                {section.items.map((item) => (
                  <div
                    key={item.combo}
                    className="flex items-center justify-between py-1.5 text-sm"
                  >
                    <span className="text-foreground/90">{item.label}</span>
                    <kbd
                      dir="ltr"
                      className="ms-auto px-2 py-1 text-[11px] font-mono bg-muted rounded border border-border/70 text-muted-foreground"
                    >
                      {item.combo
                        .split(" ")
                        .map((c) => formatCombo(c))
                        .join(" then ")}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Wires up the shortcuts help modal (Mod+Shift+/) and the global navigation
 * `g` chords. Mount once inside an authenticated layout.
 */
export function GlobalShortcutsProvider() {
  const tr = pageMessages.useT();

  const [helpOpen, setHelpOpen] = useState(false);
  const [, navigate] = useLocation();

  useKeyboardShortcuts([
    {
      combo: "mod+shift+/",
      handler: () => setHelpOpen(true),
      allowInInputs: true,
      description: tr("showKeyboardShortcuts"),
    },
    {
      combo: "?",
      handler: () => setHelpOpen(true),
      description: tr("showKeyboardShortcuts"),
    },
  ]);

  // `g` chords: press 'g' then a target letter within ~1.5s.
  useGoToChord(navigate);

  return <ShortcutsHelp open={helpOpen} onOpenChange={setHelpOpen} />;
}

const GO_TO_TARGETS: Record<string, string> = {
  d: "/dashboard",
  i: "/invoices",
  j: "/journal",
  r: "/reports",
  c: "/contacts",
  p: "/payroll",
  v: "/vat-filing",
  b: "/bank-reconciliation",
};

function useGoToChord(navigate: (path: string) => void) {
  useKeyboardShortcuts([
    {
      combo: "g",
      handler: () => {
        const onSecond = (e: KeyboardEvent) => {
          window.removeEventListener("keydown", onSecond, true);
          window.clearTimeout(timeout);
          const target = GO_TO_TARGETS[e.key.toLowerCase()];
          if (target) {
            e.preventDefault();
            navigate(target);
          }
        };
        const timeout = window.setTimeout(() => {
          window.removeEventListener("keydown", onSecond, true);
        }, 1500);
        window.addEventListener("keydown", onSecond, true);
      },
    },
  ]);
}
