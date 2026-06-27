#!/bin/bash
# Double-click to preview the Najma Al Raeda website at http://localhost:8080
cd "$(dirname "$0")"
echo "──────────────────────────────────────────────"
echo "  Najma Al Raeda — serving at http://localhost:8080"
echo "  Keep this window open. Press Ctrl+C to stop."
echo "──────────────────────────────────────────────"
( sleep 1 && open "http://localhost:8080" ) &
python3 -m http.server 8080
