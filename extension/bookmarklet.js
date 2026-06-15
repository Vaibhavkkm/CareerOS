// Send to CareerOS — bookmarklet (readable source).
//
// Drag the minified version (see extension/README.md) to your bookmarks bar. On any
// job posting, click it: it scrapes the page and POSTs it to your local CareerOS
// panel's /api/inbox, which queues it onto your board via the engine. No install,
// no permissions — but note some sites' Content-Security-Policy block fetch() to
// localhost; on those, use the browser EXTENSION in this folder instead.
javascript:(function () {
  var ENDPOINT = 'http://127.0.0.1:4317/api/inbox';
  function meta(s) { var e = document.querySelector(s); return (e && e.content || '').trim(); }
  var title = meta('meta[property="og:title"]') || document.title || '';
  var company = meta('meta[property="og:site_name"]') || '';
  var desc = (window.getSelection ? String(window.getSelection()) : '').trim()
    || meta('meta[name="description"]') || meta('meta[property="og:description"]') || '';
  try {
    var ld = document.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < ld.length; i++) {
      var j = JSON.parse(ld[i].textContent);
      var a = Array.isArray(j) ? j : [j];
      for (var k = 0; k < a.length; k++) {
        var x = a[k];
        if (x && (x['@type'] === 'JobPosting' || (Array.isArray(x['@type']) && x['@type'].indexOf('JobPosting') > -1))) {
          if (x.title) title = x.title;
          if (x.hiringOrganization && x.hiringOrganization.name) company = x.hiringOrganization.name;
          if (x.description) desc = String(x.description).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        }
      }
    }
  } catch (e) {}
  fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: location.href, title: title.slice(0, 300), company: company.slice(0, 120), description: desc.slice(0, 8000) })
  }).then(function (r) { return r.json(); })
    .then(function (d) { alert(d && d.ok ? (d.message || 'Saved to CareerOS.') : 'CareerOS: ' + ((d && d.error) || 'could not save')); })
    .catch(function () { alert('Cannot reach CareerOS — start the panel with /cos ui, or use the browser extension (CSP may block this bookmarklet on this site).'); });
})();
