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
  /** The Actions run behind this check — what the Re-run button posts to. */
  workflowRunId: number | null
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

/**
 * The two gates, keyed by the workflow file that produces each.
 *
 * `name` is BOTH the workflow's `name:` and its job id, deliberately kept the
 * same string in .github/workflows/*.yml. Branch protection requires the JOB
 * name; this panel reads the WORKFLOW name. Rename one without the other and
 * the panel silently reports "not run" forever while GitHub reports green —
 * which would leave Promote permanently disabled with no error anywhere.
 */
export const REQUIRED_CHECKS = [
  { name: 'quality', file: 'quality.yml' },
  { name: 'e2e', file: 'e2e.yml' },
] as const

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

export interface WorkflowRun {
  id: number
  name: string
  head_sha: string
  status: string
  conclusion: string | null
  html_url: string | null
}

/**
 * Fold a repository's recent workflow runs into one badge per required check.
 *
 * Pure, and unit-tested, because this is what decides whether Promote enables:
 * a mapping bug here either ships untested code or blocks a good release, and
 * neither announces itself.
 */
export function summariseRuns(
  runs: WorkflowRun[],
  required: readonly { name: string }[],
  sha: string,
): CheckSummary[] {
  return required.map(({ name }) => {
    // Newest first: a re-run creates a second run for the same commit, and the
    // latest one is the answer.
    const run = runs
      .filter(r => r.name === name && r.head_sha === sha)
      .sort((a, b) => b.id - a.id)[0]

    if (!run) return { name, status: 'missing' as const, conclusion: null, url: null, workflowRunId: null }
    return {
      name,
      status: run.status as CheckSummary['status'],
      conclusion: run.conclusion as CheckSummary['conclusion'],
      url: run.html_url,
      workflowRunId: run.id,
    }
  })
}

/**
 * Read from the Actions API rather than the Checks API.
 *
 * The panel already needs Actions read AND write for the Re-run button, so
 * this is one permission and one source of truth instead of two — and the
 * workflow run id comes back directly, which is what rerun actually needs.
 * `Checks` is also not offered as a fine-grained token permission, so asking
 * for it left every badge reading "not run" with nothing to explain why.
 */
async function checksFor(sha: string): Promise<CheckSummary[]> {
  const { owner, name } = repo()
  const perFile = await Promise.all(REQUIRED_CHECKS.map(({ file }) =>
    gh<{ workflow_runs: WorkflowRun[] }>(
      `/repos/${owner}/${name}/actions/workflows/${file}/runs?per_page=20`,
    ).catch(() => ({ workflow_runs: [] as WorkflowRun[] })),
  ))
  return summariseRuns(perFile.flatMap(r => r.workflow_runs), REQUIRED_CHECKS, sha)
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

export async function rerunCheck(workflowRunId: number): Promise<void> {
  const { owner, name } = repo()
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
