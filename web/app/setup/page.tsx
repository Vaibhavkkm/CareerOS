'use client';
import { TopBar } from '@/components/TopBar';
import { CvUpload } from '@/components/CvUpload';

export default function SetupPage() {
  return (
    <div className="app">
      <TopBar />
      <div className="statusline">
        <span>
          teach CareerOS your <b>facts</b> — upload your CV(s)
        </span>
        <div className="statusline__right">
          <span>parsed in Claude Code · merged into your master</span>
        </div>
      </div>
      <div className="main">
        <div className="page">
          <div className="page__h">Set up · upload your CV</div>
          <div className="page__lead">
            Drop in the CV(s) you already have. CareerOS reads them for your real facts — where you worked, what you
            did, your numbers — and builds your <b>master CV</b>, the ground truth every tailored CV is generated from.
            Have more than one? Upload them all: a technical CV, an academic one, an older one — each holds facts the
            others miss, and they’re merged into one richer master (deduplicated, nothing invented).
          </div>
          <CvUpload />
        </div>
      </div>
    </div>
  );
}
