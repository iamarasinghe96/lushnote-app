// Try a pull request on this computer, against the local database.
//
//   npm run review -- 81            pull request #81
//   npm run review -- some-branch   a branch
//   npm run review                  what is live now (main)
//
// Fetches that exact code, installs packages if they changed, and starts local
// mode (scripts/dev-local.mjs): http://localhost:3000, made-up data, nothing
// live touched. Ctrl+C stops it. Extra flags pass through, e.g.
// `npm run review -- 81 --reset`.
//
// This is where a change is tested before it is promoted. Staging on Vercel
// still exists to look at, but it shares the live database.

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const target = args.find(a => !a.startsWith('--')) ?? 'main'
const passThrough = args.filter(a => a.startsWith('--'))
const WIN = process.platform === 'win32'

function say(msg) { process.stdout.write(`\n[review] ${msg}\n`) }
function fail(msg) { process.stderr.write(`\n[review] ${msg}\n\n`); process.exit(1) }
function git(...a) {
  const r = spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' })
  if (r.error) fail('Git is not installed. Install it from https://git-scm.com, open a new terminal, and run this again.')
  return r
}

// Switching code under someone's uncommitted work would lose it, or mix it in.
const dirty = git('status', '--porcelain', '--untracked-files=no').stdout.trim()
if (dirty) fail(`This folder has changes that are not committed:\n${dirty}\n\nCommit or stash them first (git stash), then run this again.`)

const isPr = /^\d+$/.test(target)
const ref = isPr ? `pull/${target}/head` : target
say(`Fetching ${isPr ? `pull request #${target}` : target}...`)
const fetched = git('fetch', 'origin', ref)
if (fetched.status !== 0) fail(`Could not fetch ${isPr ? `pull request #${target}` : target}:\n${fetched.stderr.trim()}`)
// Detached, so reviewing never creates or changes a local branch.
const checkedOut = git('checkout', '--detach', 'FETCH_HEAD')
if (checkedOut.status !== 0) fail(`Could not switch to it:\n${checkedOut.stderr.trim()}`)
const sha = git('rev-parse', '--short', 'HEAD').stdout.trim()
const title = git('log', '-1', '--format=%s').stdout.trim()

// Packages only when package-lock.json changed since the last install here.
const lock = createHash('sha256').update(readFileSync(join(ROOT, 'package-lock.json'))).digest('hex')
const stamp = join(ROOT, 'node_modules', '.review-lock-hash')
if (!existsSync(stamp) || readFileSync(stamp, 'utf8') !== lock) {
  say('Installing packages (only when they changed)...')
  const ci = spawnSync(WIN ? 'npm.cmd' : 'npm', ['ci', '--no-audit', '--no-fund'], { cwd: ROOT, stdio: 'inherit', shell: WIN })
  if (ci.status !== 0) fail('Installing packages failed. The messages above say why.')
  writeFileSync(stamp, lock)
}

say(`Reviewing ${isPr ? `#${target}` : target} at ${sha}: ${title}\n  When you are done: Ctrl+C, then "git checkout main" to go back.`)

// A fresh process, so the local-mode launcher that runs is the one from the
// code under review, not the one that was here before.
const child = spawn(process.execPath, [join(ROOT, 'scripts', 'dev-local.mjs'), ...passThrough], { cwd: ROOT, stdio: 'inherit' })
process.on('SIGINT', () => {})
child.on('exit', code => process.exit(code ?? 0))
