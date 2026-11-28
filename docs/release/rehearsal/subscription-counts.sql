SELECT (SELECT count(*) FROM public.subscriptions WHERE plan_id = 'free') AS free_rows,
       (SELECT count(*) FROM public.companies c
         WHERE NOT EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.company_id = c.id))
         AS companies_without_subscription
\gset
