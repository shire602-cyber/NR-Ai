#!/bin/bash
# Double-click to rename the Vercel project to "najma-raeda" and redeploy.
cd "$(dirname "$0")"
clear
echo "────────────────────────────────────────────────────────────"
echo "   Renaming Vercel project  →  najma-raeda"
echo "   (creates najma-raeda, redeploys, removes the old project)"
echo "────────────────────────────────────────────────────────────"
echo ""
rm -rf .vercel
npx --yes vercel@latest project add najma-raeda 2>/dev/null
npx --yes vercel@latest link --yes --project najma-raeda
npx --yes vercel@latest deploy --prod --yes
echo ""
echo "Cleaning up the old project..."
yes | npx --yes vercel@latest project rm najma-al-raeda-website 2>/dev/null
echo ""
echo "────────────────────────────────────────────────────────────"
echo "   Done. New URL:  https://najma-raeda.vercel.app"
echo "────────────────────────────────────────────────────────────"
echo "Press any key to close."
read -n 1 -s
