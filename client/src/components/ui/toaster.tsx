import { CheckCircle2, AlertTriangle, AlertCircle, Info } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"
import { cn } from "@/lib/utils"

const VARIANT_ICON = {
  default: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  destructive: AlertCircle,
} as const

const VARIANT_ICON_COLOR = {
  default: "text-muted-foreground",
  success: "text-[hsl(var(--chart-5))]",
  warning: "text-[hsl(var(--chart-4))]",
  destructive: "text-destructive-foreground",
} as const

type ToastVariant = keyof typeof VARIANT_ICON

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, variant, ...props }) {
        const v: ToastVariant = (variant as ToastVariant) ?? "default"
        const Icon = VARIANT_ICON[v]
        return (
          <Toast key={id} variant={variant} {...props}>
            <div className="flex items-start gap-3 flex-1">
              {Icon && (
                <Icon
                  aria-hidden="true"
                  className={cn(
                    "mt-0.5 h-5 w-5 shrink-0",
                    VARIANT_ICON_COLOR[v],
                  )}
                />
              )}
              <div className="grid gap-1 flex-1">
                {title && <ToastTitle>{title}</ToastTitle>}
                {description && (
                  <ToastDescription>{description}</ToastDescription>
                )}
              </div>
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
