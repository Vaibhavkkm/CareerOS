// Send to CareerOS — popup logic (MV3, no build step, plain JS).
//
// Reads the active tab, best-effort scrapes the job title / company / description
// from the page, and POSTs them to the local CareerOS panel's /api/inbox endpoint
// (which routes the write through the engine's hunt-ingest — see web/app/api/inbox).
// It never submits an application; it only queues the posting onto the board.

const $ = (id) => document.getElementById(id);
const DEFAULT_ENDPOINT = 'http://127.0.0.1:4317';

// Runs IN the page (via chrome.scripting) to pull the best title/company/description
// without any site-specific coupling: prefer Open Graph / JSON-LD JobPosting, then
// fall back to the document title and any selected text.
function scrapeJob() {
  const meta = (sel) => document.querySelector(sel)?.content?.trim() || '';
  let title = meta('meta[property="og:title"]') || document.title || '';
  let company = meta('meta[property="og:site_name"]') || '';
  let description = (window.getSelection?.().toString() || '').trim()
    || meta('meta[name="description"]')
    || meta('meta[property="og:description"]') || '';

  // schema.org JobPosting (Greenhouse/Lever/LinkedIn often embed this) is the
  // richest source — use it when present.
  try {
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      const json = JSON.parse(s.textContent);
      const arr = Array.isArray(json) ? json : [json];
      const jp = arr.find((x) => x && (x['@type'] === 'JobPosting' || (Array.isArray(x['@type']) && x['@type'].includes('JobPosting'))));
      if (jp) {
        if (jp.title) title = jp.title;
        if (jp.hiringOrganization?.name) company = jp.hiringOrganization.name;
        if (jp.description) description = String(jp.description).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        break;
      }
    }
  } catch { /* malformed JSON-LD — ignore */ }

  return { title: title.slice(0, 300), company: company.slice(0, 120), description: description.slice(0, 8000), url: location.href };
}

let captured = { url: '', title: '', company: '', description: '' };

async function init() {
  const stored = await chrome.storage.local.get('endpoint');
  if (stored.endpoint) $('endpoint').value = stored.endpoint;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  captured.url = tab?.url || '';
  $('title').value = tab?.title || '';

  // Try to enrich from the page; a restricted page (chrome://, store pages) will
  // throw — fall back to the tab title/url we already have.
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: scrapeJob });
    if (result) {
      captured = { ...captured, ...result };
      if (result.title) $('title').value = result.title;
      if (result.company) $('company').value = result.company;
    }
  } catch { /* cannot script this page — use tab metadata only */ }

  if (!/^https?:\/\//i.test(captured.url)) {
    setStatus('Open a job posting in this tab first.', 'err');
    $('send').disabled = true;
    return;
  }
  setStatus('Ready — review and send.', 'muted');
}

function setStatus(msg, cls) {
  const el = $('status');
  el.textContent = msg;
  el.className = `status ${cls || 'muted'}`;
}

async function send() {
  const endpoint = ($('endpoint').value || DEFAULT_ENDPOINT).replace(/\/+$/, '');
  chrome.storage.local.set({ endpoint });
  $('send').disabled = true;
  setStatus('Sending…', 'muted');

  const payload = {
    url: captured.url,
    title: $('title').value.trim() || captured.title,
    company: $('company').value.trim() || captured.company,
    description: captured.description,
  };

  try {
    const res = await fetch(`${endpoint}/api/inbox`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.ok) {
      setStatus(data.message || 'Saved.', 'ok');
    } else {
      setStatus(data.error || 'Could not save.', 'err');
      $('send').disabled = false;
    }
  } catch {
    setStatus('Cannot reach CareerOS — is the panel running? (/cos ui)', 'err');
    $('send').disabled = false;
  }
}

$('send').addEventListener('click', send);
init();
