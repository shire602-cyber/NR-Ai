# NR WhatsApp Bridge

Chrome Manifest V3 extension for drafting Muhasib.ai WhatsApp jobs in WhatsApp Web.

## What It Does

- Detects Muhasib.ai pages and exposes a local browser bridge to the app.
- Opens `https://web.whatsapp.com/send?...` with the audited message body and recipient.
- Shows a WhatsApp Web banner reminding staff to review and press Send.
- Stores recent local draft jobs in Chrome extension storage for operational visibility.

## What It Does Not Do

- It does not auto-click Send.
- It does not bypass WhatsApp Web login.
- It does not provide provider-grade delivery receipts.
- It does not store OAuth, WhatsApp, or Muhasib.ai auth tokens.

## Local Install

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click **Load unpacked**.
4. Select this folder: `extensions/whatsapp-bridge`.
5. Open Muhasib.ai, then click **Check Bridge** on `/whatsapp`.

The unpacked extension has a pinned development ID:
`jlhkbnegpoefoodkdgfdolkolianihpm`. Muhasib.ai uses Chrome's
`externally_connectable` bridge first and falls back to the content-script
bridge when Chrome exposes content-script host access.
Some Chrome unpacked command-line installs still derive the ID from the local
folder path; the staging app also recognizes the observed local test ID
`fignfifoniblkonapihmkfakmlgkbkcf`.

## Delivery Semantics

Statuses remain conservative:

- `logged`: saved in Muhasib.ai but not opened by the bridge.
- `drafted`: opened in WhatsApp Web for staff review.
- `sent_unverified`: staff marked it sent manually, but Muhasib.ai has no provider receipt.
- `failed`: bridge/app could not draft or hand off the message.

The long-term production provider should be WhatsApp Business Cloud API for true delivery state.
