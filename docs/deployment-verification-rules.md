# Production Deployment Verification Rules

These rules are mandatory for NR-Ai production work.

1. Do not report a production deployment as complete until Railway shows a successful deployment and the live `/api/version` commit matches the commit that was pushed.
2. Treat a failed Railway build, failed pre-deploy migration, failed healthcheck, or old `/api/version` commit as an open production blocker.
3. Production readiness must pass before browser testing: `/health/live`, `/health/ready`, `/api/version`, `/api/auth/oauth/providers`, and an invalid login attempt that returns `401` instead of `500`.
4. Run the automated gate with `SMOKE_BASE_URL=https://nr-ai-production.up.railway.app SMOKE_EXPECTED_COMMIT=<commit> npm run verify:prod-deploy`.
5. If authenticated production testing is required, use smoke credentials from environment variables only and run `npm run smoke:prod`.
6. If Railway deploy fails, inspect the failed deployment logs before changing code. Fix the first concrete failure, then redeploy and rerun the gate.
7. Do not promote feature work while production login, database readiness, command center, Value Ops, or firm client routes are broken.
