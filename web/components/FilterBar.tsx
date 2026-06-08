'use client';
import { useState } from 'react';
import { IconScan, IconRefresh, IconGlobe } from './Icons';

export interface Filters {
  min: string;
  recent: string;
}

export interface FetchRecentOpts {
  country: string;
  city: string;
  jobType: string; // '' = any; else a JobSpy job_type (fulltime|internship|contract|temporary|parttime)
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
// names only (JobSpy rejects 2-letter codes like "us"/"ca"). ZipRecruiter + Google
// only return results for US/Canada, so those two unlock the extra boards. LinkedIn
// is deferred, so the live boards are Indeed / ZipRecruiter / Google Jobs.
export const COUNTRIES = [
  'Luxembourg', 'United States', 'Canada', 'United Kingdom', 'Germany',
  'France', 'Belgium', 'Netherlands', 'Switzerland', 'Italy', 'India',
];

// Sentinel: fetch every country in COUNTRIES, one after another (the fetch writes a
// shared dedup ledger, so the page runs them sequentially — see runFetch).
export const ALL_COUNTRIES = 'All countries';

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
      <div className="toolbar__spacer" />

      {/* Live multi-board fetch: country + city → Indeed/ZipRecruiter/Google */}
      <div className="field">
        <span className="field__label">country</span>
        <select
          className="input"
          aria-label="Country"
          value={place.country}
          onChange={(e) => onPlaceChange({ ...place, country: e.target.value })}
          style={{ width: 170 }}
          disabled={busy}
        >
          <option value={ALL_COUNTRIES}>🌍 All countries</option>
          {COUNTRIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <span className="field__label">type</span>
        <select
          className="input"
          aria-label="Job type"
          value={place.jobType}
          onChange={(e) => onPlaceChange({ ...place, jobType: e.target.value })}
          style={{ width: 150 }}
          disabled={busy}
          title="Restrict the fetch to a job type (e.g. Internship, Permanent, Fixed-term)"
        >
          {JOB_TYPES.map(([val, label]) => (
            <option key={val || 'any'} value={val}>
              {label}
            </option>
          ))}
        </select>
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
          placeholder={place.country === ALL_COUNTRIES ? 'city — n/a for all' : 'city (optional)…'}
          value={place.country === ALL_COUNTRIES ? '' : place.city}
          onChange={(e) => onPlaceChange({ ...place, city: e.target.value })}
          style={{ width: 130 }}
          disabled={busy || place.country === ALL_COUNTRIES}
          title={place.country === ALL_COUNTRIES ? 'City is ignored when fetching all countries' : undefined}
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
          const u = url.trim();
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
  );
}
