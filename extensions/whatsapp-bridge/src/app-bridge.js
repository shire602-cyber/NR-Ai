const REQUEST_TYPE = 'NR_WHATSAPP_BRIDGE_REQUEST';
const RESPONSE_TYPE = 'NR_WHATSAPP_BRIDGE_RESPONSE';

function respond(requestId, ok, payload, error) {
  window.postMessage({
    type: RESPONSE_TYPE,
    requestId,
    ok,
    payload,
    error,
  }, window.location.origin);
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.type !== REQUEST_TYPE || !data.requestId) return;

  if (data.command === 'ping') {
    respond(data.requestId, true, {
      available: true,
      extensionId: chrome.runtime.id,
      version: chrome.runtime.getManifest().version,
    });
    return;
  }

  if (data.command !== 'draft') {
    respond(data.requestId, false, null, 'Unknown bridge command');
    return;
  }

  chrome.runtime.sendMessage({
    type: 'NR_WHATSAPP_DRAFT_JOB',
    payload: data.payload,
  }, (response) => {
    if (chrome.runtime.lastError) {
      respond(data.requestId, false, null, chrome.runtime.lastError.message);
      return;
    }
    respond(data.requestId, Boolean(response?.ok), response || null, response?.error);
  });
});

window.postMessage({
  type: RESPONSE_TYPE,
  requestId: 'bridge-ready',
  ok: true,
  payload: {
    available: true,
    extensionId: chrome.runtime.id,
    version: chrome.runtime.getManifest().version,
  },
}, window.location.origin);
