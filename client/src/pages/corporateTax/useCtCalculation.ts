import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";

interface Selection {
  companyId: string | null | undefined;
  periodStart: string;
  periodEnd: string;
}

const selectionKey = (s: Selection) => JSON.stringify([s.companyId, s.periodStart, s.periodEnd]);

/**
 * The ledger calculation for the selected company and period. A result exists only after a
 * successful request for exactly that selection: it is dropped when the selection changes or a
 * recalculation starts, and a response that arrives for another selection is ignored.
 */
export function useCtCalculation<R>({
  request,
  onSuccess,
  onError,
  ...selection
}: Selection & {
  request: (selection: Selection) => Promise<R>;
  onSuccess?: (result: R) => void;
  onError?: (error: Error) => void;
}) {
  const key = selectionKey(selection);
  const [state, setState] = useState<{ key: string; result: R | null }>({ key, result: null });
  // Adjusting state during render drops the old figures before they can paint.
  if (state.key !== key) setState({ key, result: null });

  const selectedKey = useRef(key);
  useEffect(() => {
    selectedKey.current = key;
  }, [key]);

  const mutation = useMutation({
    mutationFn: (requested: Selection) => request(requested),
    onMutate: () => setState((current) => ({ ...current, result: null })),
    onSuccess: (result: R, requested) => {
      const requestedKey = selectionKey(requested);
      setState((current) => (current.key === requestedKey ? { ...current, result } : current));
      if (selectedKey.current === requestedKey) onSuccess?.(result);
    },
    onError: (error: Error, requested) => {
      if (selectedKey.current === selectionKey(requested)) onError?.(error);
    },
  });

  return {
    calculation: state.key === key ? state.result : null,
    calculate: () => mutation.mutate(selection),
    reset: () => setState((current) => ({ ...current, result: null })),
    isPending: mutation.isPending,
  };
}
