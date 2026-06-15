// server/handlers/command.mjs — dispatch generic {cmd, target} commands
// Zero-token commands run scripts directly (no LLM needed).
// LLM commands delegate to the matching handler.
import { runScript } from '../run.mjs';
import * as evaluateHandler from './evaluate.mjs';
import * as buildCvHandler from './build-cv.mjs';
import * as buildClHandler from './build-cl.mjs';

// These commands are zero-token: just run the script and return its output
const ZERO_TOKEN_CMDS = {
  gaps: () => runScript('gaps.mjs', ['--json'], { timeoutMs: 30_000 }),
  salary: () => runScript('salary.mjs', ['--json'], { timeoutMs: 30_000 }),
  lint: () => runScript('cv-lint.mjs', ['--json'], { timeoutMs: 30_000 }),
  'cv-lint': () => runScript('cv-lint.mjs', ['--json'], { timeoutMs: 30_000 }),
  'style-learn': () => runScript('style-profile.mjs', ['--json'], { timeoutMs: 60_000 }),
  scan: () => runScript('scan.mjs', ['--json'], { timeoutMs: 60_000 }),
};

// LLM commands — route to the matching handler
const LLM_CMDS = {
  evaluate: (args, gen) => evaluateHandler.handle(args, gen),
  'build-cv': (args, gen) => buildCvHandler.handle(args, gen),
  'build-cl': (args, gen) => buildClHandler.handle(args, gen),
};

export async function handle(args, generate) {
  // args: { cmd, target?, ...rest }
  const { cmd, target, ...rest } = args;
  if (!cmd) throw new Error('command handler: missing cmd in args');

  // Zero-token path — no LLM call
  if (ZERO_TOKEN_CMDS[cmd]) {
    const r = await ZERO_TOKEN_CMDS[cmd]();
    if (!r.ok) throw new Error(`${cmd} failed: ${r.error || 'script error'}`);
    return { cmd, result: r.data };
  }

  // LLM path
  if (LLM_CMDS[cmd]) {
    const cmdArgs = { target, ...rest };
    return LLM_CMDS[cmd](cmdArgs, generate);
  }

  // Remaining modes: produce a text response via the mode playbook
  // (interview-prep, mock, referral, negotiate, outreach, research, compare)
  const { collectMode, collectProfile, buildContextBlock, truncate } = await import('./collect.mjs');

  const systemPrompt = collectMode(cmd);
  const profile = collectProfile();
  const contextBlock = buildContextBlock({ profile });

  const userMessage = [
    contextBlock,
    '',
    '## Task',
    target ? `Run the "${cmd}" mode for target: ${target}` : `Run the "${cmd}" mode.`,
    'Follow your system instructions exactly.',
    'Write the complete output. No preamble.',
  ].join('\n');

  const output = await generate(systemPrompt, userMessage);
  return { cmd, target, output };
}
