/**
 * Derive the effective selection for a list without a "sync state" effect.
 *
 * Keeps the user's pick while it is still in the list; otherwise falls back to
 * the first item. With an empty list the pick is returned unchanged so a
 * selection survives a refetch that is still loading.
 */
export function resolveSelectedId<T extends { id: string }>(
  picked: string | null,
  items: readonly T[]
): string | null {
  if (items.length === 0) return picked;
  if (picked && items.some((item) => item.id === picked)) return picked;
  return items[0].id;
}
