import { useLocation, useRoute } from "wouter";

/**
 * Routing for a full-page document editor (spec 3.7): `<base>/new` and `<base>/:id/edit`.
 * `editor` is "new", the id being edited, or undefined on the list. `routed` is false when the page
 * is rendered outside its own path (unit tests), where the editor simply opens in place.
 */
export function useEditorRoute(base: string) {
  const [location, navigate] = useLocation();
  const routed = location === base || location.startsWith(`${base}/`);
  const [isNew] = useRoute(`${base}/new`);
  const [isEdit, params] = useRoute<{ id: string }>(`${base}/:id/edit`);
  const editor: string | undefined = isNew ? "new" : isEdit ? params?.id : undefined;
  return {
    routed,
    editor,
    /** Go to the blank editor page. */
    toNew: () => navigate(`${base}/new`),
    /** Go to the editor page of one record. */
    toEdit: (id: string) => navigate(`${base}/${id}/edit`),
    /** Back to the list. */
    toList: () => navigate(base),
  };
}
