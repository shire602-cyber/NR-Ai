import { useLayoutEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";

interface Selection {
  companyId: string | null | undefined;
  periodStart: string;
  periodEnd: string;
}

interface Attempt {
  requested: Selection;
  controller: AbortController;
}

const selectionKey = (s: Selection) => JSON.stringify([s.companyId, s.periodStart, s.periodEnd]);

/**
 * The ledger calculation for the selected company and period. A result exists only after a
 * successful request for exactly that selection: it is dropped when the selection changes or a
 * recalculation starts. Each request owns an AbortController, aborted when the selection changes
 * or the screen unmounts; an aborted request is ignored however and whenever it settles, even if
 * the same selection has been chosen again.
 */
export function useCtCalculation<R>({
  request,
  onSuccess,
  onError,
  ...selection
}: Selection & {
  request: (selection: Selection, signal: AbortSignal) => Promise<R>;
  onSuccess?: (result: R) => void;
  onError?: (error: Error) => void;
}) {
  const key = selectionKey(selection);
  const [state, setState] = useState<{ key: string; result: R | null }>({ key, result: null });
  // Adjusting state during render drops the old figures before they can paint.
  if (state.key !== key) setState({ key, result: null });

  const mutation = useMutation({
    mutationFn: ({ requested, controller }: Attempt) => request(requested, controller.signal),
    onMutate: () => setState((current) => ({ ...current, result: null })),
    onSuccess: (result: R, { requested, controller }) => {
      if (controller.signal.aborted) return;
      const requestedKey = selectionKey(requested);
      setState((current) => (current.key === requestedKey ? { ...current, result } : current));
      onSuccess?.(result);
    },
    onError: (error: Error, { controller }) => {
      if (!controller.signal.aborted) onError?.(error);
    },
  });

  const inFlight = useRef<AbortController | null>(null);
  const { reset: detach } = mutation;
  // The cleanup runs as a new selection commits (before any late response) and on unmount.
  // Detaching the mutation also clears isPending, so the new selection can be calculated.
  useLayoutEffect(
    () => () => {
      inFlight.current?.abort();
      detach();
    },
    [key, detach]
  );

  return {
    calculation: state.key === key ? state.result : null,
    calculate: () => {
      inFlight.current?.abort();
      inFlight.current = new AbortController();
      mutation.mutate({ requested: selection, controller: inFlight.current });
    },
    reset: () => setState((current) => ({ ...current, result: null })),
    isPending: mutation.isPending,
  };
}
