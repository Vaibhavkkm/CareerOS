#!/usr/bin/env python3
"""
jobspy_fetch.py — zero-LLM multi-board job fetch for CareerOS.

A thin sidecar over python-jobspy (https://github.com/speedyapply/JobSpy). It
reads a JSON config from --config <file> or stdin, scrapes each board with
PER-BOARD graceful degradation, and prints a JSON array of postings on stdout
in the exact shape scripts/hunt-ingest.mjs already consumes:

    [{ "title", "company", "location", "url", "posted", "description", "source" }, ...]

Design rules (match the project ethos):
  • stdout carries ONLY the data array — clean, parseable by the Node wrapper.
  • stderr carries diagnostics as JSON (per-board counts/errors, or a fatal),
    so the Node side can surface them without corrupting the data stream.
  • this file NEVER writes under data/ — the Node side (hunt-ingest.mjs) owns
    dedup + persistence. It never auto-applies. It never fabricates a listing.
  • one board failing must not sink the others (try/except per board+term).

LinkedIn is intentionally NOT in the default board set — it rate-limits/blocks
scrapers hardest. It can be enabled explicitly via the "sites" config, with the
understanding that runs may 429 or return partial results.
"""
import sys
import json
import argparse

# Boards JobSpy supports that we expose. Google needs a google_search_term.
KNOWN_SITES = {"indeed", "zip_recruiter", "google", "glassdoor", "linkedin", "bayt", "naukri", "bdjobs"}
DESC_CAP = 8000  # keep a saved JD useful without ballooning the JSON payload


def eprint(obj):
    sys.stderr.write(json.dumps(obj) + "\n")
    sys.stderr.flush()


def _s(v):
    """Coerce any cell (incl. pandas NaN/NaT) to a trimmed string, '' if empty."""
    if v is None:
        return ""
    # NaN is the only value not equal to itself; covers float('nan') and pd.NaT.
    try:
        if v != v:
            return ""
    except Exception:
        pass
    s = str(v).strip()
    return "" if s.lower() in ("nan", "nat", "none") else s


def row_to_posting(row, site):
    """Map one JobSpy DataFrame row (a Series) to a hunt-ingest posting."""
    g = lambda k: _s(row.get(k))
    title = g("title")
    url = g("job_url") or g("job_url_direct")
    if not title or not url:
        return None
    location = g("location")
    if not location:
        location = ", ".join(p for p in (g("city"), g("state"), g("country")) if p)
    desc = g("description")
    if len(desc) > DESC_CAP:
        desc = desc[:DESC_CAP]
    return {
        "title": title,
        "company": g("company"),
        "location": location,
        "url": url,
        "posted": g("date_posted"),
        "description": desc,
        "source": site,
    }


def main():
    ap = argparse.ArgumentParser(description="CareerOS JobSpy sidecar")
    ap.add_argument("--config", help="path to a JSON config file; omit to read stdin")
    args = ap.parse_args()

    try:
        raw = open(args.config, "r", encoding="utf-8").read() if args.config else sys.stdin.read()
        cfg = json.loads(raw) if raw.strip() else {}
    except Exception as e:
        eprint({"fatal": "could not read/parse config", "detail": str(e)})
        print("[]")
        return 1

    sites = [s for s in (cfg.get("sites") or ["indeed", "zip_recruiter", "google"]) if s in KNOWN_SITES]
    if not sites:
        sites = ["indeed"]
    search_terms = [t for t in (cfg.get("search_terms") or ["data engineer"]) if str(t).strip()]
    location = (cfg.get("location") or "").strip()
    country = (cfg.get("country") or "Luxembourg").strip()
    results_wanted = int(cfg.get("results_wanted") or 20)
    hours_old = cfg.get("hours_old")
    hours_old = int(hours_old) if hours_old else None
    job_type = (cfg.get("job_type") or None)
    is_remote = bool(cfg.get("is_remote") or False)
    proxies = cfg.get("proxies") or None  # ['user:pass@host:port', ...]
    where = location or country

    try:
        from jobspy import scrape_jobs
    except Exception as e:
        eprint({
            "fatal": "python-jobspy not installed",
            "detail": str(e),
            "hint": "run: npm run jobspy:install   (creates .venv and installs python-jobspy)",
        })
        print("[]")
        return 1

    out = []
    diag = {"where": where, "country": country, "boards": []}
    for site in sites:
        for term in search_terms:
            entry = {"site": site, "term": term}
            try:
                df = scrape_jobs(
                    site_name=[site],
                    search_term=term,
                    google_search_term=(f"{term} jobs near {where}" if site == "google" else None),
                    location=where,
                    results_wanted=results_wanted,
                    hours_old=hours_old,
                    country_indeed=country,
                    job_type=job_type,
                    is_remote=is_remote,
                    proxies=proxies,
                    verbose=0,
                )
                n = 0 if df is None else len(df)
                entry["count"] = int(n)
                diag["boards"].append(entry)
                if df is None or n == 0:
                    continue
                for _, r in df.iterrows():
                    rec = row_to_posting(r, site)
                    if rec:
                        out.append(rec)
            except Exception as e:
                entry["error"] = str(e)[:300]
                diag["boards"].append(entry)

    diag["received"] = len(out)
    eprint(diag)
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
