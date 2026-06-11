export type Band = 'STRONGEST' | 'Very strong' | 'Strong' | 'Moderate' | 'Weak';

export interface BoardRow {
  company: string;
  role: string;
  url: string;
  posted: string;
  location: string;
  experience: string;
  jd_path: string;
  source: string;
  score: number;
  fit: number;
  band: Band;
  have: string[];
  gap: string[];
  languages?: string;
  pinned?: boolean; // a just-fetched posting forced to the top of the board
}

export interface BoardResponse {
  ok: boolean;
  today: string;
  count: number;
  shown?: number;
  rows: BoardRow[];
  error?: string;
}

export interface TrackerRecord {
  id: number;
  date: string;
  company: string;
  role: string;
  score: number | null;
  status: string;
  archetype?: string;
  legitimacy?: string;
  url?: string;
  report?: string;
  notes?: string;
  cv_pdf?: string;
  cl_pdf?: string;
  follow_ups?: number;
  last_action?: string;
}

export interface TrackerStats {
  total: number;
  byStatus: Record<string, number>;
  byStatusLabeled: Record<string, number>;
  avgScore: number | null;
  pctPdf: number;
  pctReport: number;
}

export type QueueStatus = 'queued' | 'claimed' | 'done' | 'failed';
export type QueueKind = 'onboard' | 'evaluate' | 'build-cv' | 'build-cl' | 'apply' | 'hunt' | 'style';

export interface QueueRequest {
  id: string;
  kind: QueueKind;
  args: Record<string, unknown>;
  status: QueueStatus;
  created: string;
  claimed_at: string | null;
  completed_at: string | null;
  result: unknown;
  error: string | null;
  origin: string;
}

export interface JdDetail {
  ok: boolean;
  role: string;
  company: string;
  url: string;
  location: string;
  posted: string;
  body: string;
  error?: string;
}

export interface ReportDetail {
  ok: boolean;
  summary: Record<string, unknown> | null;
  prose: string;
  error?: string;
}
