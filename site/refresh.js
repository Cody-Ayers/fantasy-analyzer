// The "Refresh" button: asks GitHub to run the refresh workflow, waits for it,
// then reloads the page's data.
//
// A public website can't keep a secret, so the GitHub token is never in this
// code or the repo. You paste a token once per device; it stays in that
// browser's storage and is only ever sent to api.github.com. Give the token
// access to just this repo with "Actions: Read and write" and nothing else.

const WORKFLOW = 'refresh.yml';
const API = 'https://api.github.com';
const KEY = 'lineuplab.githubToken';

// cody-ayers.github.io/fantasy-analyzer/ → owner "cody-ayers", repo "fantasy-analyzer"
export function repoFromLocation(loc = window.location) {
  const m = loc.hostname.match(/^([^.]+)\.github\.io$/);
  const repo = loc.pathname.split('/').filter(Boolean)[0];
  return m && repo ? { owner: m[1], repo } : null;
}

export const actionsPage = (r) => `https://github.com/${r.owner}/${r.repo}/actions/workflows/${WORKFLOW}`;
export const tokenPage = 'https://github.com/settings/personal-access-tokens/new';

export const token = {
  get() { try { return localStorage.getItem(KEY); } catch { return null; } },
  set(v) { try { localStorage.setItem(KEY, v); } catch { /* storage blocked */ } },
  clear() { try { localStorage.removeItem(KEY); } catch { /* storage blocked */ } },
};

async function gh(path, tok, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${tok}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (res.status === 401) throw Object.assign(new Error('GitHub rejected the token. Paste a new one.'), { badToken: true });
  if (res.status === 403 || res.status === 404) {
    throw Object.assign(new Error('The token can\'t run this workflow. Give it "Actions: Read and write" on this repo.'), { badToken: true });
  }
  if (!res.ok) throw new Error(`GitHub said ${res.status}.`);
  return res.status === 204 ? null : res.json();
}

// Is a refresh already queued or running (from another phone, the schedule, a push)?
// Used by the automatic game-day refresh so it never piles up duplicate runs.
export async function refreshRunning(repo, tok) {
  const base = `/repos/${repo.owner}/${repo.repo}/actions/workflows/${WORKFLOW}`;
  for (const status of ['queued', 'in_progress']) {
    const { total_count: n } = await gh(`${base}/runs?status=${status}&per_page=1`, tok);
    if (n) return true;
  }
  return false;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Start the workflow and report progress through onStep(text) until it finishes.
export async function runRefresh(repo, tok, onStep) {
  const base = `/repos/${repo.owner}/${repo.repo}/actions/workflows/${WORKFLOW}`;
  const started = Date.now() - 5000;   // allow for clock differences
  onStep('Starting');
  await gh(`${base}/dispatches`, tok, { method: 'POST', body: JSON.stringify({ ref: 'main' }) });

  // Find the run we just started, then poll it until it's done.
  let run = null;
  for (let i = 0; i < 90; i++) {           // up to ~6 minutes
    await sleep(i < 3 ? 3000 : 4000);
    const { workflow_runs: runs } = await gh(`${base}/runs?event=workflow_dispatch&per_page=5`, tok);
    run = runs.find((r) => new Date(r.created_at).getTime() >= started) || run;
    if (!run) { onStep('Waiting for GitHub'); continue; }
    if (run.status === 'completed') break;
    onStep(run.status === 'queued' ? 'Queued' : 'Pulling ESPN data');
  }
  if (!run || run.status !== 'completed') throw new Error('Still running. Check back in a minute.');
  if (run.conclusion !== 'success') {
    throw Object.assign(new Error('The refresh failed. Open GitHub to see why (often expired ESPN cookies).'), { url: run.html_url });
  }
  return run;
}
