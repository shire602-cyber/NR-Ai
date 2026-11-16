import { Check, Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme, type ThemePreference } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n";

const OPTIONS: { value: ThemePreference; icon: typeof Sun; labelKey: string }[] = [
  { value: "light", icon: Sun, labelKey: "shell.themeLight" },
  { value: "dark", icon: Moon, labelKey: "shell.themeDark" },
  { value: "system", icon: Monitor, labelKey: "shell.themeSystem" },
];

/** Top-bar control: light / dark / follow the OS. */
export function ThemeToggle({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { preference, resolved, setPreference } = useTheme();
  const Icon = resolved === "dark" ? Moon : Sun;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn("text-muted-foreground hover:text-foreground", className)}
          aria-label={t["shell.themeToggle"]}
          title={t["shell.themeToggle"]}
          data-testid="button-theme-toggle"
        >
          <Icon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>{t["shell.themeLabel"]}</DropdownMenuLabel>
        {OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => setPreference(option.value)}
            data-testid={`theme-option-${option.value}`}
          >
            <option.icon className="text-muted-foreground" aria-hidden />
            <span className="flex-1">{t[option.labelKey]}</span>
            {preference === option.value && <Check className="text-accent" aria-hidden />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
