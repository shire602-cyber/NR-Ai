# NR Accounting — Brand assets

Premium navy + gold identity for the NR Accounting platform.

## Name
**NR Accounting** — wordmark set in Poppins (Bold for "NR", Medium for "Accounting").

## Palette
| Role | Hex |
|------|-----|
| Navy Ink (primary text, mark base top) | `#11294C` |
| Navy Deep (mark base bottom, dark panels) | `#0A1A30` |
| Gold (primary accent) | `#CBA24C` |
| Gold Light (gradient highlight) | `#E4C879` |

Mark background is a vertical navy gradient (`#1B3A66` → `#0A1A30`); the "NR" uses a
vertical gold gradient (`#E4C879` → `#CBA24C`).

## Files
- `logo-mark.svg` — the app-icon / monogram (square, scalable). Source of all favicons.
- `logo-horizontal.svg` — primary lockup for **light** backgrounds (navy wordmark).
- `logo-horizontal-dark.svg` — lockup for **dark/navy** backgrounds (white "NR" + gold "Accounting").
- `brand-board.png` — one-page overview (mark, lockups, palette, favicon sizes).
- `png/` — high-res raster exports (`logo-mark-1024.png`, `logo-horizontal.png`, `logo-horizontal-on-navy.png`).
- `favicons/` — ready-to-ship favicon set (see below).
- `build_logo.py` — regenerates the SVGs from the Poppins font (outlined paths, font-independent).

## Favicon set (`favicons/`)
`favicon.ico` (16/32/48), `favicon.svg`, `apple-touch-icon.png` (180),
`android-chrome-192x192.png`, `android-chrome-512x512.png`, plus raw `icon-16/32/48/64/180/192/512.png`.

### Wiring into the app (client `index.html` `<head>`)
```html
<link rel="icon" href="/favicon.ico" sizes="any" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<link rel="manifest" href="/site.webmanifest" />
```
Copy the favicon files into the client's `public/` folder so they're served at the site root.

`site.webmanifest` example:
```json
{
  "name": "NR Accounting",
  "short_name": "NR Accounting",
  "icons": [
    { "src": "/android-chrome-192x192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/android-chrome-512x512.png", "sizes": "512x512", "type": "image/png" }
  ],
  "theme_color": "#0A1A30",
  "background_color": "#0A1A30",
  "display": "standalone"
}
```
