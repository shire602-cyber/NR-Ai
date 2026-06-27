const REQUEST_TYPE = "NR_WHATSAPP_BRIDGE_REQUEST";
const RESPONSE_TYPE = "NR_WHATSAPP_BRIDGE_RESPONSE";

if (globalThis.__NR_WHATSAPP_BRIDGE_APP_LOADED__) {
  // Chrome MV3 can inject this file statically and programmatically depending
  // on site-access state. Keep one listener per isolated world.
} else {
  globalThis.__NR_WHATSAPP_BRIDGE_APP_LOADED__ = true;

  function respond(requestId, ok, payload, error) {
    window.postMessage(
      {
        type: RESPONSE_TYPE,
        requestId,
        ok,
        payload,
        error,
      },
      window.location.origin
    );
  }

  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.type !== REQUEST_TYPE || !data.requestId) return;

    if (data.command === "ping") {
      respond(data.requestId, true, {
        available: true,
        extensionId: chrome.runtime.id,
        version: chrome.runtime.getManifest().version,
      });
      return;
    }

    if (data.command !== "draft") {
      respond(data.requestId, false, null, "Unknown bridge command");
      return;
    }

    chrome.runtime.sendMessage(
      {
        type: "NR_WHATSAPP_DRAFT_JOB",
        payload: data.payload,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          respond(data.requestId, false, null, chrome.runtime.lastError.message);
          return;
        }
        respond(data.requestId, Boolean(response?.ok), response || null, response?.error);
      }
    );
  });

  window.postMessage(
    {
      type: RESPONSE_TYPE,
      requestId: "bridge-ready",
      ok: true,
      payload: {
        available: true,
        extensionId: chrome.runtime.id,
        version: chrome.runtime.getManifest().version,
      },
    },
    window.location.origin
  );
}
