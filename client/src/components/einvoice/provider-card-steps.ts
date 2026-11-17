/** E2: step icons shared by the provider cards (kept out of the component file for fast refresh). */
import { CheckCircle2, Circle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type StepState = "done" | "current" | "todo" | "failed";

export const STEP_ICON: Record<StepState, typeof Circle> = {
  done: CheckCircle2,
  current: Circle,
  todo: Circle,
  failed: XCircle,
};

export const stepIconClass = (state: StepState) =>
  cn(
    "mt-0.5 h-4 w-4 shrink-0",
    state === "done" && "text-success",
    state === "current" && "text-warning",
    state === "failed" && "text-danger",
    state === "todo" && "text-muted-foreground"
  );
