'use client';
import { useState } from 'react';
import { IconScan, IconRefresh, IconGlobe } from './Icons';
import { MultiSelect } from './MultiSelect';

export interface Filters {
  min: string;
  recent: string;
}

export interface FetchRecentOpts {
  countries: string[]; // [] = all countries (no filter); else a subset to filter + fetch
  city: string;
  jobTypes: string[]; // [] = any type; else JobSpy job_types to filter + fetch
}

// Job-type values → friendly labels. '' = every type. The first four map to
// native JobSpy job_type filters; "phd"/"postdoc" aren't JobSpy types, so the
// fetch turns them into search terms instead (handled in scripts/jobspy.mjs),
// while the board's display filter classifies them from the role title.
export const JOB_TYPES: [string, string][] = [
  ['', 'Any type'],
  ['fulltime', 'Full-time / Permanent'],
  ['internship', 'Internship'],
  ['phd', 'PhD / Doctoral'],
  ['postdoc', 'Post-Doc'],
  ['contract', 'Contract'],
  ['temporary', 'Fixed-term / Temp'],
  ['parttime', 'Part-time'],
];

// The "+" signals these are MINIMUM bands (this band or better), e.g. STRONG+
// includes Strong, Very strong and Strongest — so picking STRONG+ still shows your
// very best matches on top, by design.
const BANDS: [string, string][] = [
  ['', 'ALL'],
  ['STRONGEST', 'STRONGEST'],
  ['Very strong', 'V.STRONG+'],
  ['Strong', 'STRONG+'],
  ['Moderate', 'MOD+'],
];
const RECENCY: [string, string][] = [
  ['', 'ANY'],
  ['7', '7D'],
  ['14', '14D'],
  ['30', '30D'],
];

// Country drives JobSpy's country_indeed; city drives its location. Full country
// names only (JobSpy rejects 2-letter codes like "us"/"ca"), and each name here
// must lowercase-match an entry in JobSpy's `Country` enum (it resolves via
// Country.from_string) — every one below is verified against that list.
// ZipRecruiter + Google only return results for US/Canada, so those two unlock the
// extra boards; the rest still scrape Indeed (and Google Jobs as a best effort).
// LinkedIn is deferred, so the live boards are Indeed / ZipRecruiter / Google Jobs.
// Curated to well-known job markets and grouped by region for the dropdown.
export const COUNTRIES = [
  // Home + North America
  'Luxembourg', 'United States', 'Canada',
  // Europe
  'United Kingdom', 'Ireland', 'Germany', 'France', 'Belgium', 'Netherlands',
  'Switzerland', 'Austria', 'Italy', 'Spain', 'Portugal', 'Sweden', 'Norway',
  'Denmark', 'Poland',
  // Asia-Pacific + Middle East
  'Australia', 'New Zealand', 'Japan', 'Singapore', 'United Arab Emirates', 'India',
  // Latin America + Africa
  'Brazil', 'Mexico', 'South Africa',
];

// Sentinel: fetch every country in COUNTRIES, one after another (the fetch writes a
// shared dedup ledger, so the page runs them sequentially — see runFetch).
export const ALL_COUNTRIES = 'All countries';

// Pull the first http(s) URL out of pasted text. Pastes often arrive with extra
// baggage (surrounding quotes, a dragged-in file path, trailing prose); feeding
// that to the fetcher pollutes the stored posting URL. Trailing punctuation that
// commonly clings to URLs in prose is stripped; '' if no URL is present at all.
export function extractUrl(text: string): string {
  const m = text.match(/https?:\/\/[^\s'"<>]+/i);
  return m ? m[0].replace(/[)\],.;]+$/, '') : '';
}

export function FilterBar({
  filters,
  onChange,
  place,
  onPlaceChange,
  onRefresh,
  onScan,
  onFetchUrl,
  onFetchRecent,
  busy,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  place: FetchRecentOpts;
  onPlaceChange: (p: FetchRecentOpts) => void;
  onRefresh: () => void;
  onScan: () => void;
  onFetchUrl: (url: string) => void;
  onFetchRecent: (opts: FetchRecentOpts) => void;
  busy?: boolean;
}) {
  const [url, setUrl] = useState('');
  // On mobile the secondary fetch/source controls collapse behind a toggle so the
  // board is visible immediately; on desktop they're always shown (CSS handles it).
  const [moreOpen, setMoreOpen] = useState(false);
  return (
    <div className="toolbar">
      <div className="field">
        <span className="field__label">match</span>
        <div className="seg">
          {BANDS.map(([val, label]) => (
            <button
              key={label}
              className={`seg__btn ${filters.min === val ? 'seg__btn--on' : ''}`}
              onClick={() => onChange({ ...filters, min: val })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="field__label">posted</span>
        <div className="seg">
          {RECENCY.map(([val, label]) => (
            <button
              key={label}
              className={`seg__btn ${filters.recent === val ? 'seg__btn--on' : ''}`}
              onClick={() => onChange({ ...filters, recent: val })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        className="toolbar__more-toggle"
        aria-expanded={moreOpen}
        onClick={() => setMoreOpen((o) => !o)}
      >
        {moreOpen ? '× close' : '+ filters & sources'}
      </button>

      <div className={`toolbar__more ${moreOpen ? 'is-open' : ''}`}>
        <div className="toolbar__spacer" />

        {/* Live multi-board fetch: country + city → Indeed/ZipRecruiter/Google.
            Country & Type are MULTI-select (tick several) — they filter the board AND
            scope the fetch. Empty = all / any. */}
        <div className="field">
          <span className="field__label">country</span>
          <MultiSelect
            ariaLabel="Country (multi-select)"
            options={COUNTRIES.map((c) => [c, c] as [string, string])}
            selected={place.countries}
            onChange={(countries) => onPlaceChange({ ...place, countries })}
            emptyLabel="🌍 All countries"
            width={170}
            disabled={busy}
          />
        </div>
        <div className="field">
          <span className="field__label">type</span>
          <MultiSelect
            ariaLabel="Job type (multi-select)"
            options={JOB_TYPES.filter(([v]) => v).map(([v, l]) => [v, l] as [string, string])}
            selected={place.jobTypes}
            onChange={(jobTypes) => onPlaceChange({ ...place, jobTypes })}
            emptyLabel="Any type"
            width={150}
            disabled={busy}
          />
        </div>
      <form
        className="field"
        onSubmit={(e) => {
          e.preventDefault();
          onFetchRecent(place);
        }}
      >
        <input
          className="input"
          aria-label="City"
          placeholder={place.countries.length === 1 ? 'city (optional)…' : 'city — pick 1 country'}
          value={place.countries.length === 1 ? place.city : ''}
          onChange={(e) => onPlaceChange({ ...place, city: e.target.value })}
          style={{ width: 130 }}
          disabled={busy || place.countries.length !== 1}
          title={place.countries.length === 1 ? undefined : 'City applies when exactly one country is selected'}
        />
      </form>
      <button
        className="btn"
        onClick={() => onFetchRecent(place)}
        disabled={busy}
        title="Fetch only recent listings (uses the 'posted' window) from Indeed, ZipRecruiter & Google Jobs"
      >
        <IconGlobe /> fetch recent
      </button>

      <form
        className="field"
        onSubmit={(e) => {
          e.preventDefault();
          const u = extractUrl(url);
          if (u) {
            onFetchUrl(u);
            setUrl('');
          }
        }}
      >
        <input
          className="input"
          aria-label="Paste a job URL"
          placeholder="paste a job URL…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          style={{ width: 180 }}
        />
        <button
          type="submit"
          className="btn"
          disabled={busy || !extractUrl(url)}
          title="Fetch this job posting onto the board (scan is for tracked company portals — it ignores this box)"
        >
          fetch URL
        </button>
      </form>
      <button className="btn" onClick={onScan} disabled={busy}>
        <IconScan /> scan
      </button>
      <button
        className="btn btn--ghost"
        onClick={onRefresh}
        disabled={busy}
        title="Fetch ALL jobs matched to your CV (recent + older) for the selected country/city across Indeed · ZipRecruiter · Google, then re-rank the board"
      >
        <IconRefresh /> refresh
      </button>
      </div>
    </div>
  );
}
