const JOB_STORAGE_KEY = 'nrWhatsappBridgeJobs';
const APP_HOSTS = new Set([
  'nr-ai-staging.up.railway.app',
  'nr-ai-production.up.railway.app',
  'nr-ai.up.railway.app',
  'localhost',
  '127.0.0.1',
]);

function scriptForUrl(url) {
  let parsed;
  try {
    parsed = new URL(url || '');
  } catch {
    return null;
  }

  if (APP_HOSTS.has(parsed.hostname)) return 'src/app-bridge.js';
  if (parsed.hostname === 'web.whatsapp.com') return 'src/whatsapp-web.js';
  return null;
}

async function injectBridgeScript(tabId, url) {
  const file = scriptForUrl(url);
  if (!file || !tabId) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [file],
    });
  } catch {
    // The tab may be restricted, gone, or not ready. Static content_scripts
    // and the next navigation event still provide coverage.
  }
}

function normalizePhone(raw) {
  let cleaned = String(raw || '').replace(/[^\d]/g, '');
  if (!cleaned) return '';
  if (cleaned.length === 10 && cleaned.startsWith('05')) cleaned = `971${cleaned.slice(1)}`;
  else if (cleaned.length === 9 && cleaned.startsWith('5')) cleaned = `971${cleaned}`;
  else if (cleaned.startsWith('00')) cleaned = cleaned.slice(2);
  else if (cleaned.startsWith('0')) cleaned = cleaned.slice(1);
  if (cleaned.length < 8 || cleaned.length > 15) return '';
  return cleaned;
}

function buildWhatsAppUrl(job) {
  const phone = normalizePhone(job.phone);
  if (!phone) throw new Error('Invalid WhatsApp phone number');
  const text = encodeURIComponent(String(job.message || '').slice(0, 5000));
  return `https://web.whatsapp.com/send?phone=${phone}&text=${text}&app_absent=0`;
}

async function appendJob(job, status) {
  const stored = await chrome.storage.local.get(JOB_STORAGE_KEY);
  const jobs = Array.isArray(stored[JOB_STORAGE_KEY]) ? stored[JOB_STORAGE_KEY] : [];
  const next = [
    {
      ...job,
      status,
      updatedAt: new Date().toISOString(),
    },
    ...jobs.filter((item) => item.jobId !== job.jobId),
  ].slice(0, 50);
  await chrome.storage.local.set({ [JOB_STORAGE_KEY]: next });
  return next[0];
}

async function openDraft(job) {
  if (!job?.jobId || !job?.phone || !job?.message) {
    throw new Error('Bridge job is missing phone, message, or id');
  }

  const url = buildWhatsAppUrl(job);
  const storedJob = await appendJob(job, 'draft_opening');
  const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
  const target = tabs.find((tab) => tab.id);

  if (target?.id) {
    await chrome.tabs.update(target.id, { active: true, url });
    if (target.windowId) await chrome.windows.update(target.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ active: true, url });
  }

  await appendJob(storedJob, 'drafted');
  return {
    ok: true,
    mode: 'extension',
    message: 'Draft opened in WhatsApp Web',
    extensionId: chrome.runtime.id,
    version: chrome.runtime.getManifest().version,
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'NR_WHATSAPP_DRAFT_JOB') return false;

  openDraft(message.payload)
    .then(sendResponse)
    .catch((error) => sendResponse({
      ok: false,
      mode: 'extension',
      error: error?.message || 'Could not open WhatsApp Web',
    }));
  return true;
});

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  const senderUrl = sender?.url || sender?.origin || '';
  let senderHost = '';
  try {
    senderHost = new URL(senderUrl).hostname;
  } catch {
    sendResponse({
      ok: false,
      mode: 'extension',
      error: 'Unsupported sender',
    });
    return false;
  }

  if (!APP_HOSTS.has(senderHost) || message?.type !== 'NR_WHATSAPP_BRIDGE_EXTERNAL_REQUEST') {
    sendResponse({
      ok: false,
      mode: 'extension',
      error: 'Unsupported sender',
    });
    return false;
  }

  if (message.command === 'ping') {
    sendResponse({
      ok: true,
      mode: 'extension',
      payload: {
        available: true,
        extensionId: chrome.runtime.id,
        version: chrome.runtime.getManifest().version,
      },
    });
    return false;
  }

  if (message.command !== 'draft') {
    sendResponse({
      ok: false,
      mode: 'extension',
      error: 'Unknown bridge command',
    });
    return false;
  }

  openDraft(message.payload)
    .then((result) => sendResponse({
      ok: true,
      mode: 'extension',
      payload: result,
    }))
    .catch((error) => sendResponse({
      ok: false,
      mode: 'extension',
      error: error?.message || 'Could not open WhatsApp Web',
    }));
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ installedAt: new Date().toISOString() });
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) injectBridgeScript(tab.id, tab.url);
  });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) injectBridgeScript(tab.id, tab.url);
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = changeInfo.url || tab.url;
  if (changeInfo.status === 'loading' || changeInfo.status === 'complete' || changeInfo.url) {
    injectBridgeScript(tabId, url);
  }
});
