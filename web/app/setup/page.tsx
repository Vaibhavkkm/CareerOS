'use client';
import { useEffect, useState } from 'react';
import { TopBar } from '@/components/TopBar';
import { OnboardWizard } from '@/components/OnboardWizard';
import { api } from '@/components/util';

interface OnboardStatus {
  ok: boolean;
  hasProfile: boolean;
  hasMaster: boolean;
  pendingBatches: string[];
}

export default function SetupPage() {
  const [status, setStatus] = useState<OnboardStatus | null>(null);
  const [done, setDone] = useState(false);
  const [statusErr, setStatusErr] = useState(false);

  useEffect(() => {
    setStatusErr(false);
    api<OnboardStatus>('/api/onboard/status').then((r) => {
      if (r && r.ok !== false) setStatus(r);
      else setStatusErr(true);
    }).catch(() => setStatusErr(true));
  }, [done]);

  const isSetUp = status?.hasProfile && status?.hasMaster;

  return (
    <div className="app">
      <TopBar />
      <div className="statusline">
        <span>
          {isSetUp ? (
            <>profile <b>ready</b> — update or re-onboard below</>
          ) : (
            <>set up CareerOS — upload your CV and fill your profile</>
          )}
        </span>
        <div className="statusline__right">
          {isSetUp && <span className="pill pill--done">profile set</span>}
        </div>
      </div>
      <div className="main">
        <div className="page">
          <div className="page__h">
            {isSetUp ? 'Update your profile' : 'Set up · onboard'}
          </div>
          <div className="page__lead">
            {isSetUp ? (
              <>Your profile is set. Upload a new CV or edit your details below to update your master CV and profile.</>
            ) : (
              <>Upload your existing CV(s) and fill in a few details. CareerOS reads your real facts — where you worked, what you built, your numbers — and builds your <b>master CV</b>, the ground truth every tailored CV is generated from.</>
            )}
          </div>

          {statusErr ? (
            <div style={{ marginTop: 24 }}>
              <div className="upload__status err">Could not load profile status. Is the server running?</div>
              <button className="btn" style={{ marginTop: 12 }} onClick={() => { setStatusErr(false); setDone((d) => !d); }}>
                Retry
              </button>
            </div>
          ) : status ? (
            <OnboardWizard
              hasProfile={status.hasProfile}
              hasMaster={status.hasMaster}
              onDone={() => setDone((d) => !d)}
            />
          ) : (
            <div className="faint" style={{ marginTop: 24 }}>Loading…</div>
          )}
        </div>
      </div>
    </div>
  );
}
