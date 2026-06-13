// server/adapters/claude-cli.mjs — call `claude --print` (user's Claude Code subscription)
// The prompt is the full self-contained context; no tool use needed since daemon
// pre-collects all data and injects it. LLM's job is pure text generation.
import { spawn } from 'node:child_process';

export async function call(systemPrompt, userMessage, { model } = {}) {
  // Combine system + user into one prompt (--print doesn't take a separate system arg)
  const full = [
    'You are CareerOS, an AI-powered career assistant.',
    'SYSTEM INSTRUCTIONS:',
    systemPrompt,
    '',
    'USER REQUEST:',
    userMessage,
    '',
    'Respond with ONLY the requested artifact (report markdown, LaTeX source, etc.).',
    'No preamble, no explanation, no markdown wrapper unless the artifact itself is markdown.',
  ].join('\n');

  return new Promise((resolve, reject) => {
    // Use --print flag for non-interactive mode; -p is the short form
    const args = ['--print'];
    if (model) args.push('--model', model);

    const proc = spawn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    proc.stdin.write(full);
    proc.stdin.end();

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (code !== 0 && !stdout.trim()) {
        reject(new Error(`claude exited ${code}: ${stderr.slice(0, 300)}`));
        return;
      }
      resolve(stdout.trim());
    });

    proc.on('error', (e) => reject(new Error(`claude not found: ${e.message}. Is Claude Code installed?`)));

    // Hard timeout: 10 min (LaTeX CV/CL generation needs significant time)
    setTimeout(() => { proc.kill(); reject(new Error('claude timed out after 10 min')); }, 600_000);
  });
}
