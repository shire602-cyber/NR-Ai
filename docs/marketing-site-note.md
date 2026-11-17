# Marketing site (`sites/najma-al-raeda-website/`)

`sites/najma-al-raeda-website/` is the static marketing website of the Najma Al Raeda accounting firm
(about 34 HTML, CSS and JS files plus macOS `.command` helper scripts). It is a different product from
the Muhasib.ai application: it shares no code, build or deployment with it. It is excluded from the Docker
build context (`.dockerignore`), ESLint, Prettier, Vitest and knip, and `tsconfig.json` never includes it.
We recommend moving it to its own repository (with its own Vercel project) and deleting the folder from
this one; git history keeps the files. The earlier stale full fork of this app that lived in
`sites/najma-raeda-site/` was deleted.
