#!/bin/bash
# Double-click to deploy the Najma Al Raeda website to Vercel.
# First time: a browser window opens for you to log in to Vercel.
# Then just press Enter at each prompt — the defaults are correct.
cd "$(dirname "$0")"
clear
echo "────────────────────────────────────────────────────────────"
echo "   Deploying Najma Al Raeda  →  Vercel"
echo ""
echo "   • First run: a browser opens so you can log in to Vercel."
echo "   • At each question, the default answer is correct —"
echo "     just press Enter. Project name: najma-al-raeda-website."
echo "   • When it finishes, your live URL is printed below."
echo "────────────────────────────────────────────────────────────"
echo ""
npx --yes vercel@latest --prod
echo ""
echo "────────────────────────────────────────────────────────────"
echo "   If a Production URL is shown above, you are LIVE."
echo "   Add your domain (nraccounts.com) in the Vercel dashboard:"
echo "   Project  →  Settings  →  Domains."
echo "────────────────────────────────────────────────────────────"
echo "Press any key to close."
read -n 1 -s
