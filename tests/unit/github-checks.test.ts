import { describe, it, expect } from 'vitest'
import { summariseRuns, REQUIRED_CHECKS, type WorkflowRun } from '@/lib/github'

// This mapping decides whether Promote enables. A bug here either ships
// untested code or blocks a good release, and neither announces itself — so
// every shape GitHub can return is pinned down.

const SHA = 'a7885559d2171c034109d56c9e7a87cb9d1c6832'
const OTHER = 'b0000000000000000000000000000000000000000'

function run(over: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 1, name: 'quality', head_sha: SHA,
    status: 'completed', conclusion: 'success',
    html_url: 'https://github.com/run/1',
    ...over,
  }
}

describe('summariseRuns', () => {
  it('reports a passing run', () => {
    const [quality] = summariseRuns([run()], [{ name: 'quality' }], SHA)
    expect(quality).toMatchObject({ name: 'quality', status: 'completed', conclusion: 'success', workflowRunId: 1 })
  })

  it('returns one entry per required check, in order, even with no runs at all', () => {
    // A commit Vercel never deployed has no e2e run. Missing must be a state,
    // not a crash — the panel has to render something.
    const summary = summariseRuns([], REQUIRED_CHECKS, SHA)
    expect(summary.map(s => s.name)).toEqual(['quality', 'e2e'])
    for (const s of summary) {
      expect(s.status).toBe('missing')
      expect(s.workflowRunId).toBe(null)
      expect(s.conclusion).toBe(null)
    }
  })

  it('ignores a run for a different commit', () => {
    // The Actions list is repository-wide and returns the last 20 runs, which
    // will mostly be for other commits. Reading one of those as this commit's
    // result would enable Promote on someone else's green run.
    const [quality] = summariseRuns([run({ head_sha: OTHER })], [{ name: 'quality' }], SHA)
    expect(quality.status).toBe('missing')
  })

  it('ignores a run for a different workflow', () => {
    const [e2e] = summariseRuns([run({ name: 'quality' })], [{ name: 'e2e' }], SHA)
    expect(e2e.status).toBe('missing')
  })

  it('takes the newest run when a check has been re-run', () => {
    // Re-running does not replace the failed run, it adds a newer one. Reading
    // the older one would leave Promote disabled after a successful re-run.
    const summary = summariseRuns([
      run({ id: 10, conclusion: 'failure' }),
      run({ id: 42, conclusion: 'success' }),
      run({ id: 7, conclusion: 'failure' }),
    ], [{ name: 'quality' }], SHA)
    expect(summary[0]).toMatchObject({ conclusion: 'success', workflowRunId: 42 })
  })

  it('keeps GitHub own vocabulary for a run still going', () => {
    const [quality] = summariseRuns([run({ status: 'in_progress', conclusion: null })], [{ name: 'quality' }], SHA)
    expect(quality.status).toBe('in_progress')
    expect(quality.conclusion).toBe(null)
  })

  it('carries the log url through so a failure is one click away', () => {
    const [quality] = summariseRuns([run({ conclusion: 'failure' })], [{ name: 'quality' }], SHA)
    expect(quality.url).toBe('https://github.com/run/1')
  })
})

describe('REQUIRED_CHECKS', () => {
  it('names each workflow file alongside the check name', () => {
    // The name is both the workflow name: and the job id in the yml. Branch
    // protection requires the job name; this panel reads the workflow name.
    expect(REQUIRED_CHECKS).toEqual([
      { name: 'quality', file: 'quality.yml' },
      { name: 'e2e', file: 'e2e.yml' },
    ])
  })
})
