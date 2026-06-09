# Send to CareerOS — browser extension + bookmarklet

One click to send the job posting you're viewing (LinkedIn, Greenhouse, Lever,
Indeed, a company careers page — anywhere) straight onto your local CareerOS board,
instead of copy-pasting the URL into Claude Code.

It POSTs the page to your **local** CareerOS panel (`/api/inbox`), which routes the
write through the engine's `hunt-ingest` — so the job is deduped against everything
`scan`/`hunt`/`fetch recent` already saw and lands on your board ranked against your
CV. It **never** applies or marks anything; it only queues the posting for you to
review and tailor (`/cos build-cv`).

> Prerequisite: the CareerOS panel must be running locally. Start it with
> **`/cos ui`** in Claude Code (or `npm run web:dev`) → it listens on
> `http://127.0.0.1:4317`. The panel binds `127.0.0.1` only — nothing is exposed to
> the network, and the receive endpoint is disabled in public-demo mode.

---

## Option A — Browser extension (recommended; works everywhere)

A bookmarklet can be blocked by a site's Content-Security-Policy (LinkedIn, for
one). The extension isn't, because it fetches from its own context.

**Install (Chrome / Edge / Brave — unpacked, no store needed):**
1. Go to `chrome://extensions`.
2. Toggle **Developer mode** (top right).
3. Click **Load unpacked** and select this `extension/` folder.
4. Pin **Send to CareerOS**. On any job page, click it → review the auto-filled role
   + company → **Send this job to my board**.

The popup auto-scrapes the title/company/description from the page's Open Graph and
schema.org `JobPosting` data, falling back to the tab title. You can edit the panel
URL under **Settings** if you run it on a different port.

(Firefox: load `manifest.json` via `about:debugging` → *This Firefox* → *Load
Temporary Add-on*.)

---

## Option B — Bookmarklet (no install; may be CSP-blocked on some sites)

1. Create a new bookmark (bookmarks bar → right-click → Add page / New bookmark).
2. Name it **Send to CareerOS**.
3. Paste this as the **URL**:

```
javascript:(function(){var E="http://127.0.0.1:4317/api/inbox";function m(s){var e=document.querySelector(s);return(e&&e.content||"").trim()}var t=m('meta[property="og:title"]')||document.title||"",c=m('meta[property="og:site_name"]')||"",d=(window.getSelection?String(window.getSelection()):"").trim()||m('meta[name="description"]')||m('meta[property="og:description"]')||"";try{var L=document.querySelectorAll('script[type="application/ld+json"]');for(var i=0;i<L.length;i++){var j=JSON.parse(L[i].textContent),a=Array.isArray(j)?j:[j];for(var k=0;k<a.length;k++){var x=a[k];if(x&&(x["@type"]==="JobPosting"||(Array.isArray(x["@type"])&&x["@type"].indexOf("JobPosting")>-1))){if(x.title)t=x.title;if(x.hiringOrganization&&x.hiringOrganization.name)c=x.hiringOrganization.name;if(x.description)d=String(x.description).replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim()}}}}catch(e){}fetch(E,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:location.href,title:t.slice(0,300),company:c.slice(0,120),description:d.slice(0,8000)})}).then(function(r){return r.json()}).then(function(o){alert(o&&o.ok?(o.message||"Saved to CareerOS."):"CareerOS: "+((o&&o.error)||"could not save"))}).catch(function(){alert("Cannot reach CareerOS — start it with /cos ui, or use the extension.")})})();
```

4. On a job posting, click the bookmark. You'll get a "Saved to your CareerOS board"
   alert. The readable source is in [`bookmarklet.js`](bookmarklet.js).

---

## After sending
Open the panel (`/cos ui`) or run `/cos board` — the job is on your board, scored
against your CV, ready to tailor. Nothing was applied to; you're always in control.

## Troubleshooting
- **"Cannot reach CareerOS"** — the panel isn't running. Start it: `/cos ui`.
- **Bookmarklet does nothing on LinkedIn** — that's CSP; use the extension instead.
- **"Already on your board"** — the dedup engine recognised it; no harm done.
