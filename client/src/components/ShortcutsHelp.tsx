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
import { useTranslation } from "@/lib/i18n";

const SHORTCUTS = [
  {
    group: "components.shortcutsGroupGeneral",
    items: [
      { combo: "mod+k", label: "components.shortcutsOpenPalette" },
      { combo: "/", label: "components.shortcutsSearch" },
      { combo: "mod+shift+/", label: "components.shortcutsShowHelp" },
      { combo: "escape", label: "components.shortcutsClose" },
    ],
  },
  {
    group: "components.shortcutsGroupNavigation",
    items: [
      { combo: "g d", label: "components.shortcutsGoDashboard" },
      { combo: "g i", label: "components.shortcutsGoInvoices" },
      { combo: "g j", label: "components.shortcutsGoJournal" },
      { combo: "g r", label: "components.shortcutsGoReports" },
      { combo: "g c", label: "components.shortcutsGoContacts" },
    ],
  },
  {
    group: "components.shortcutsGroupLists",
    items: [
      { combo: "j", label: "components.shortcutsMoveDown" },
      { combo: "k", label: "components.shortcutsMoveUp" },
      { combo: "enter", label: "components.shortcutsOpenSelected" },
    ],
  },
  {
    group: "components.shortcutsGroupCreate",
    items: [{ combo: "n", label: "components.shortcutsNewInvoice" }],
  },
];

interface ShortcutsHelpProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShortcutsHelp({ open, onOpenChange }: ShortcutsHelpProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t["components.shortcutsTitle"]}</DialogTitle>
          <DialogDescription>{t["components.shortcutsDescription"]}</DialogDescription>
        </DialogHeader>
        <div className="space-y-5 pt-2 max-h-[60vh] overflow-y-auto">
          {SHORTCUTS.map((section) => (
            <div key={section.group}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                {t[section.group]}
              </h3>
              <div className="space-y-1">
                {section.items.map((item) => (
                  <div
                    key={item.combo}
                    className="flex items-center justify-between py-1.5 text-sm"
                  >
                    <span className="text-foreground/90">{t[item.label]}</span>
                    <kbd className="ms-auto px-2 py-1 text-[11px] font-mono bg-muted rounded border border-border/70 text-muted-foreground">
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
  const [helpOpen, setHelpOpen] = useState(false);
  const [, navigate] = useLocation();

  useKeyboardShortcuts([
    {
      combo: "mod+shift+/",
      handler: () => setHelpOpen(true),
      allowInInputs: true,
      description: "Show keyboard shortcuts",
    },
    {
      combo: "?",
      handler: () => setHelpOpen(true),
      description: "Show keyboard shortcuts",
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
