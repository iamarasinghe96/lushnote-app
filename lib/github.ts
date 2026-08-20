// The GitHub side of the release pipeline.
//
// Everything here runs server-side behind requireAdmin. The token is a
// fine-grained personal access token scoped to this one repository, and it
// never reaches the browser — the panel asks this app, this app asks GitHub.

const API = 'https://api.github.com'

export interface CheckSummary {
  name: string
  /** GitHub's own vocabulary, kept rather than translated so the panel can
   *  distinguish "still running" from "never started". */
  status: 'queued' | 'in_progress' | 'completed' | 'missing'
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | 'neutral' | 'stale' | null
  url: string | null
  runId: number | null
}

export interface PullSummary {
  number: number
  title: string
  branch: string
  headSha: string
  author: string
  draft: boolean
  url: string
  updatedAt: string
  changedFiles: number
  additions: number
  deletions: number
  previewUrl: string | null
  checks: CheckSummary[]
  mergeable: boolean | null
  /** Empty when the pull request is safe to promote; otherwise the reason it
   *  is not, in words the panel shows on the disabled button. */
  blockedReason: string
}

export const REQUIRED_CHECKS = ['quality', 'e2e'] as const

export function githubConfigured(): boolean {
  return !!process.env.GITHUB_TOKEN && !!process.env.GITHUB_REPO
}

function repo(): { owner: string; name: string } {
  const full = process.env.GITHUB_REPO ?? ''
  const [owner, name] = full.split('/')
  if (!owner || !name) throw new Error('GITHUB_REPO must be owner/name')
  return { owner, name }
}

async function gh<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string> | undefined),
    },
    cache: 'no-store',
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    // The message is shown to the admin, so it says what GitHub refused rather
    // than "request failed" — a 403 here is nearly always a missing PAT scope.
    throw new Error(`GitHub ${res.status} on ${path}: ${body.slice(0, 300)}`)
  }
  return res.status === 204 ? (undefined as T) : (await res.json()) as T
}

interface RawPull {
  number: number
  title: string
  draft: boolean
  html_url: string
  updated_at: string
  head: { ref: string; sha: string }
  user: { login: string } | null
  mergeable: boolean | null
  changed_files?: number
  additions?: number
  deletions?: number
}

export async function mainHeadSha(): Promise<string> {
  const { owner, name } = repo()
  const ref = await gh<{ object: { sha: string } }>(`/repos/${owner}/${name}/git/ref/heads/main`)
  return ref.object.sha
}

/** The Vercel Preview URL for a commit, read from GitHub's Deployments API —
 *  the same record the e2e workflow is triggered by, so the link in the panel
 *  and the URL the tests ran against are the same thing by construction. */
async function previewUrlFor(sha: string): Promise<string | null> {
  const { owner, name } = repo()
  const deployments = await gh<Array<{ id: number; environment: string }>>(
    `/repos/${owner}/${name}/deployments?sha=${sha}&per_page=20`,
  ).catch(() => [])
  for (const d of deployments) {
    if (!/^preview/i.test(d.environment)) continue
    const statuses = await gh<Array<{ state: string; environment_url?: string; target_url?: string }>>(
      `/repos/${owner}/${name}/deployments/${d.id}/statuses?per_page=20`,
    ).catch(() => [])
    const ok = statuses.find(s => s.state === 'success')
    const url = ok?.environment_url || ok?.target_url
    if (url) return url
  }
  return null
}

async function checksFor(sha: string): Promise<CheckSummary[]> {
  const { owner, name } = repo()
  const data = await gh<{ check_runs: Array<{ name: string; status: string; conclusion: string | null; html_url: string | null; id: number }> }>(
    `/repos/${owner}/${name}/commits/${sha}/check-runs?per_page=100`,
  ).catch(() => ({ check_runs: [] }))

  return REQUIRED_CHECKS.map(required => {
    // Newest first: a re-run creates a second check run with the same name, and
    // the latest one is the answer.
    const run = data.check_runs.filter(r => r.name === required).sort((a, b) => b.id - a.id)[0]
    if (!run) return { name: required, status: 'missing' as const, conclusion: null, url: null, runId: null }
    return {
      name: required,
      status: run.status as CheckSummary['status'],
      conclusion: run.conclusion as CheckSummary['conclusion'],
      url: run.html_url,
      runId: run.id,
    }
  })
}

function blockedReasonFor(pull: RawPull, checks: CheckSummary[]): string {
  if (pull.draft) return 'Still a draft'
  if (pull.mergeable === false) return 'Conflicts with main — needs a rebase'
  const missing = checks.filter(c => c.status === 'missing')
  if (missing.length) {
    return missing.some(c => c.name === 'e2e')
      ? 'No preview deployment has been tested yet'
      : `${missing.map(c => c.name).join(', ')} has not run`
  }
  const running = checks.filter(c => c.status !== 'completed')
  if (running.length) return `${running.map(c => c.name).join(', ')} still running`
  const failed = checks.filter(c => c.conclusion !== 'success' && c.conclusion !== 'skipped')
  if (failed.length) return `${failed.map(c => c.name).join(', ')} failed`
  return ''
}

export async function listOpenPulls(): Promise<PullSummary[]> {
  const { owner, name } = repo()
  const list = await gh<RawPull[]>(`/repos/${owner}/${name}/pulls?state=open&base=main&sort=updated&direction=desc&per_page=20`)

  return Promise.all(list.map(async brief => {
    // mergeable and the file counts only appear on the single-pull endpoint.
    const pull = await gh<RawPull>(`/repos/${owner}/${name}/pulls/${brief.number}`).catch(() => brief)
    const [checks, previewUrl] = await Promise.all([checksFor(pull.head.sha), previewUrlFor(pull.head.sha)])
    return {
      number: pull.number,
      title: pull.title,
      branch: pull.head.ref,
      headSha: pull.head.sha,
      author: pull.user?.login ?? 'unknown',
      draft: pull.draft,
      url: pull.html_url,
      updatedAt: pull.updated_at,
      changedFiles: pull.changed_files ?? 0,
      additions: pull.additions ?? 0,
      deletions: pull.deletions ?? 0,
      previewUrl,
      checks,
      mergeable: pull.mergeable ?? null,
      blockedReason: blockedReasonFor(pull, checks),
    }
  }))
}

export async function getPull(number: number): Promise<PullSummary | null> {
  const all = await listOpenPulls()
  return all.find(p => p.number === number) ?? null
}

/** Squash-merge, guarded on the head sha. Two pushes in quick succession would
 *  otherwise let a Promote click land on a commit newer than the one whose
 *  checks the admin actually read. */
export async function promotePull(number: number, headSha: string, title: string): Promise<{ sha: string }> {
  const { owner, name } = repo()
  const result = await gh<{ sha: string }>(`/repos/${owner}/${name}/pulls/${number}/merge`, {
    method: 'PUT',
    body: JSON.stringify({ merge_method: 'squash', sha: headSha, commit_title: `${title} (#${number})` }),
  })
  return { sha: result.sha }
}

export async function deleteBranch(branch: string): Promise<void> {
  const { owner, name } = repo()
  await gh(`/repos/${owner}/${name}/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'DELETE' }).catch(() => {})
}

export async function rerunCheck(runId: number): Promise<void> {
  const { owner, name } = repo()
  // A check run belongs to a workflow run; re-running needs the parent's id.
  const run = await gh<{ check_suite: { id: number } }>(`/repos/${owner}/${name}/check-runs/${runId}`)
  const suite = await gh<{ workflow_runs: Array<{ id: number }> }>(
    `/repos/${owner}/${name}/actions/runs?check_suite_id=${run.check_suite.id}&per_page=1`,
  )
  const workflowRunId = suite.workflow_runs[0]?.id
  if (!workflowRunId) throw new Error('No workflow run behind that check')
  await gh(`/repos/${owner}/${name}/actions/runs/${workflowRunId}/rerun`, { method: 'POST' })
}

/** What lushnote.com.au is actually serving right now, asked of the site
 *  itself rather than inferred from a deployment record. */
export async function liveVersion(siteUrl: string): Promise<{ sha: string; builtAt: string | null } | null> {
  try {
    const res = await fetch(`${siteUrl.replace(/\/$/, '')}/api/version`, { cache: 'no-store' })
    if (!res.ok) return null
    const body = await res.json() as { sha?: string; builtAt?: string | null }
    return { sha: body.sha ?? 'unknown', builtAt: body.builtAt ?? null }
  } catch {
    return null
  }
}
