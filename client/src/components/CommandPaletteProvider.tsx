import { lazy, Suspense, useEffect, useState } from "react";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { OPEN_COMMAND_PALETTE_EVENT } from "@/lib/commandPalette";
import { loadLocale, useTranslation } from "@/lib/i18n";

// The palette pulls in the whole report catalog (command shortcuts for ~100 reports); it is
// loaded the first time the palette opens, not with every page of the signed-in shell.
const CommandPalette = lazy(() =>
  import("@/components/CommandPalette").then((m) => ({ default: m.CommandPalette }))
);

export function CommandPaletteProvider() {
  const [open, setOpen] = useState(false);
  // Mount the palette only after the first open so its chunk is not requested up front.
  const [everOpened, setEverOpened] = useState(false);
  // The palette reads every catalog (report text, settings, ...); a route-scoped boot (the firm
  // workspace) has not loaded them all, so wait for the full catalog before showing it.
  const { locale } = useTranslation();
  const [catalogsReady, setCatalogsReady] = useState(false);
  useEffect(() => {
    if (!everOpened) return;
    let live = true;
    void loadLocale(locale).then(() => live && setCatalogsReady(true));
    return () => {
      live = false;
    };
  }, [everOpened, locale]);

  useEffect(() => {
    const handleOpen = () => {
      setEverOpened(true);
      setOpen(true);
    };
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, handleOpen);
  }, []);

  useKeyboardShortcuts([
    {
      combo: "mod+k",
      handler: () => {
        setEverOpened(true);
        setOpen((prev) => !prev);
      },
      allowInInputs: true,
      description: "Open command palette",
    },
    {
      combo: "/",
      handler: () => {
        setEverOpened(true);
        setOpen(true);
      },
      description: "Search / open command palette",
    },
  ]);

  if (!everOpened || !catalogsReady) return null;
  return (
    <Suspense fallback={null}>
      <CommandPalette open={open} onOpenChange={setOpen} />
    </Suspense>
  );
}
