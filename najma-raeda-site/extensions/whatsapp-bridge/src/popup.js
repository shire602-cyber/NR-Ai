const JOB_STORAGE_KEY = "nrWhatsappBridgeJobs";

async function render() {
  const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
  const dot = document.getElementById("status-dot");
  const text = document.getElementById("status-text");
  const ready = tabs.length > 0;
  dot.classList.toggle("ready", ready);
  text.textContent = ready
    ? "WhatsApp Web tab is available."
    : "WhatsApp Web will open when a job is drafted.";

  const stored = await chrome.storage.local.get(JOB_STORAGE_KEY);
  const jobs = Array.isArray(stored[JOB_STORAGE_KEY]) ? stored[JOB_STORAGE_KEY] : [];
  const list = document.getElementById("jobs");
  list.innerHTML = "";

  if (jobs.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No bridge jobs yet.";
    list.appendChild(item);
    return;
  }

  for (const job of jobs.slice(0, 5)) {
    const item = document.createElement("li");
    const title = document.createElement("strong");
    title.textContent = job.recipientName || job.phone || "WhatsApp contact";
    const meta = document.createElement("span");
    meta.textContent = `${job.status || "queued"} · ${new Date(job.updatedAt || Date.now()).toLocaleString()}`;
    item.append(title, meta);
    list.appendChild(item);
  }
}

render().catch(() => {});
