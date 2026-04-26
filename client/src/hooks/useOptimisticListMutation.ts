import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';

interface OptimisticListMutationOptions<TVars, TItem> {
  /** Query key for the list cache to update. */
  queryKey: readonly unknown[];
  /** The actual network call. */
  mutationFn: (vars: TVars) => Promise<unknown>;
  /** Apply the optimistic change to a single item. */
  applyToItem: (item: TItem, vars: TVars) => TItem;
  /** Decide whether this row should be touched. */
  matches: (item: TItem, vars: TVars) => boolean;
  /** If the mutation removes the item entirely (delete-style). */
  remove?: boolean;
  successTitle?: string;
  errorTitle?: string;
  onSuccess?: () => void;
}

/**
 * Optimistic update helper for list-shaped queries: cancels in-flight queries,
 * snapshots the previous list, applies the optimistic change, rolls back on
 * error, and refetches on settle. Centralizes the invariant so each call site
 * doesn't have to repeat the dance.
 */
export function useOptimisticListMutation<TVars, TItem extends { id: string }>(
  opts: OptimisticListMutationOptions<TVars, TItem>,
) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: opts.mutationFn,
    onMutate: async (vars: TVars) => {
      await queryClient.cancelQueries({ queryKey: opts.queryKey });
      const previous = queryClient.getQueryData<TItem[]>(opts.queryKey);
      queryClient.setQueryData<TItem[]>(opts.queryKey, (old) => {
        if (!old) return old;
        if (opts.remove) {
          return old.filter((it) => !opts.matches(it, vars));
        }
        return old.map((it) => (opts.matches(it, vars) ? opts.applyToItem(it, vars) : it));
      });
      return { previous };
    },
    onError: (error: unknown, _vars, context) => {
      if (context && typeof context === 'object' && 'previous' in context) {
        const ctx = context as { previous: TItem[] | undefined };
        if (ctx.previous) {
          queryClient.setQueryData(opts.queryKey, ctx.previous);
        }
      }
      toast({
        variant: 'destructive',
        title: opts.errorTitle ?? 'Action failed',
        description: (error as Error)?.message ?? 'Please try again.',
      });
    },
    onSuccess: () => {
      if (opts.successTitle) {
        toast({ title: opts.successTitle });
      }
      opts.onSuccess?.();
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: opts.queryKey });
    },
  });
}
