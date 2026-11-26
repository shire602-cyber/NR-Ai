import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { t, useI18n, type Locale } from "@/lib/i18n";
import { yearEndRecovery } from "@/pages/month-end/yearEndRecovery";

/**
 * Failure slot for the year-end card (chunk or catalog load failed). It uses the eager base
 * labels, which exist in both locales even when the lazy catalogs did not load. Without an
 * explicit locale it follows the active one. Extra props are ignored so it can stand in for
 * the lazy card when its import rejects.
 */
export function YearEndFailure({ locale }: { locale?: Locale; [prop: string]: unknown }) {
  const activeLocale = useI18n((state) => state.locale);
  const copy = t[locale ?? activeLocale];
  return (
    <Card data-testid="year-end-close-error">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
        <p className="text-sm text-destructive" role="alert">
          {copy.yearEndCloseUnavailable}
        </p>
        <Button variant="outline" size="sm" onClick={() => yearEndRecovery.reload()}>
          {copy.yearEndCloseReload}
        </Button>
      </CardContent>
    </Card>
  );
}
