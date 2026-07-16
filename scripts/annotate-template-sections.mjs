// One-off annotator: reads data/clinical-templates.json, detects each template's
// section headings (### markdown OR whole-line **bold**), maps them to the 11
// core note fields where they semantically match, slugs the rest as "extra"
// sections, rewrites each heading line in the prompt to a `[key] Heading` marker
// so the model emits parseable markers, and writes a `sections` array onto each
// template. Emits a review report to stdout.
//
//   node scripts/annotate-template-sections.mjs          # write + report
//   node scripts/annotate-template-sections.mjs --dry    # report only
//
// Idempotent-ish: re-running on already-annotated JSON is a no-op for prompts
// that already use [key] markers (they're detected and preserved).

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FILE = join(__dirname, '..', 'data', 'clinical-templates.json')
const DRY = process.argv.includes('--dry')

const CORE_KEYS = [
  'diagnosis', 'presentation', 'history', 'medications', 'mse', 'content',
  'scales', 'risk', 'referrals', 'summary', 'nextsteps',
]

// Normalised heading text -> core field key. Matched after normalisation
// (lowercase, trailing punctuation and <u>..</u> stripped, collapsed spaces).
const CORE_SYNONYMS = new Map(Object.entries({
  // diagnosis
  'diagnosis': 'diagnosis',
  'diagnoses': 'diagnosis',
  'diagnostic impression': 'diagnosis',
  'diagnostic impressions': 'diagnosis',
  'provisional diagnosis': 'diagnosis',
  // presentation
  'presentation': 'presentation',
  'current presentation': 'presentation',
  'presenting problem': 'presentation',
  'presenting problems': 'presentation',
  'presenting problem(s)': 'presentation',
  'presenting concerns': 'presentation',
  'presenting concern': 'presentation',
  'client presentation': 'presentation',
  'presentation / current status': 'presentation',
  'presentation/current status': 'presentation',
  'current concerns': 'presentation',
  // history
  'history': 'history',
  'background': 'history',
  'background information': 'history',
  'past medical & psychiatric history': 'history',
  'past medical and psychiatric history': 'history',
  'medical history': 'history',
  'medical and mental health history': 'history',
  'personal and developmental history': 'history',
  'background information / personal history': 'history',
  'medical status and medical history': 'history',
  'psychiatric history': 'history',
  // medications
  'medications': 'medications',
  'current medications': 'medications',
  'medication history': 'medications',
  'medication': 'medications',
  // mse
  'mental status examination': 'mse',
  'mental status examination (mse)': 'mse',
  'mental state examination': 'mse',
  'mental state examination (mse)': 'mse',
  'mse': 'mse',
  // content
  'session content': 'content',
  'content': 'content',
  // scales
  'scales': 'scales',
  'rating scales': 'scales',
  'measures': 'scales',
  'outcome measures': 'scales',
  'psychometric assessment': 'scales',
  // risk
  'risk': 'risk',
  'risk assessment': 'risk',
  'risk assessment & management': 'risk',
  'risk assessment and management': 'risk',
  'risk assessment & management plan': 'risk',
  'risk assessment and management plan': 'risk',
  // referrals
  'referrals': 'referrals',
  'referral reason': 'referrals',
  'reason for referral': 'referrals',
  'referral information': 'referrals',
  'referrals & correspondence': 'referrals',
  // summary
  'summary': 'summary',
  'session summary': 'summary',
  'clinical summary': 'summary',
  // nextsteps
  'next steps': 'nextsteps',
  'plan': 'nextsteps',
  'action plan': 'nextsteps',
  'treatment plan': 'nextsteps',
  'management plan': 'nextsteps',
  'recommendations': 'nextsteps',
}))

// Heading-looking lines that are NOT real sections (sub-items, criteria codes,
// example delimiters, formatting directives). These stay in the body verbatim.
function isBlockedHeading(norm) {
  if (!norm) return true
  if (norm.length > 70) return true
  if (/^[a-z]$/.test(norm)) return true                       // single letter A, B...
  if (/^[a-h]\d+$/.test(norm)) return true                    // criteria codes A1, B2...
  if (/^dsm-5(-tr)? criteria/.test(norm)) return true
  if (/^criteri(a|on)\b/.test(norm)) return true
  if (/\bexample\b/.test(norm)) return true                   // "Example Start", "Example End"
  if (/^start on new line/.test(norm)) return true
  if (/^print /.test(norm)) return true
  if (/^section [a-z]:/.test(norm)) return true               // ABA super-headings "SECTION A:"
  if (/^confidential$/.test(norm)) return true
  return false
}

function normHeading(raw) {
  return raw
    .replace(/<\/?u>/gi, '')          // <u>..</u>
    .replace(/\\/g, '')               // escaped chars like \[
    .replace(/[*_#]+/g, '')           // stray markdown
    .replace(/[:.\s]+$/,'')           // trailing colon / period / space
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function slugify(label) {
  let s = label
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
  if (!/^[a-z]/.test(s)) s = 's_' + s
  return s
}

// A line is a heading if it is entirely a #-heading or entirely whole-line bold.
// Returns { indent, hashes|null, text } or null.
function headingOf(line) {
  const md = line.match(/^(\s*)(#{2,4})\s+(.+?)\s*$/)
  if (md) return { raw: line, text: md[3], style: 'md' }
  const bold = line.match(/^(\s*)\*\*([^*\n]{2,90})\*\*:?\s*$/)
  if (bold) return { raw: line, text: bold[2], style: 'bold' }
  // Already-annotated marker line: [key] Heading
  const mk = line.match(/^\s*\[([a-z][a-z0-9_]{1,40})\]\s*(.*)$/)
  if (mk) return { raw: line, text: mk[2] || mk[1], style: 'marker', key: mk[1] }
  return null
}

// Long-form assessment reports (ADOS item scoring sheets, DIVA/ABA multi-part
// questionnaires, cognitive-assessment reports) produce dozens of heading-like
// lines that are item ratings, not note fields. Splitting them into 30-59
// fields is worse than the current single-document behaviour, so any template
// yielding more than this many sections falls back to content-only (unchanged
// from today). Real session notes top out around 13 sections.
const MAX_SECTIONS = 20

function annotate(tpl) {
  const lines = tpl.prompt.split('\n')
  const sections = []
  const usedCoreKeys = new Set()
  const usedSlugs = new Set()
  let changed = false
  let hadDuplicateSuffix = false

  const outLines = lines.map((line) => {
    const h = headingOf(line)
    if (!h) return line

    // Preserve an existing marker line as-is (idempotent re-run).
    if (h.style === 'marker') {
      const core = CORE_KEYS.includes(h.key)
      if (core) usedCoreKeys.add(h.key)
      else usedSlugs.add(h.key)
      sections.push({ key: h.key, label: h.text, core })
      return line
    }

    const norm = normHeading(h.text)
    if (isBlockedHeading(norm)) return line

    const cleanLabel = h.text
      .replace(/<\/?u>/gi, '')
      .replace(/\\/g, '')
      .replace(/[*#]+/g, '')
      .replace(/[:\s]+$/,'')
      .trim()

    let key
    let core
    const mapped = CORE_SYNONYMS.get(norm)
    if (mapped && !usedCoreKeys.has(mapped)) {
      key = mapped
      core = true
      usedCoreKeys.add(mapped)
    } else {
      // extra section (or a repeated core heading -> extra)
      core = false
      let base = slugify(cleanLabel)
      if (base.length < 3) base = 's_' + base
      key = base
      let n = 2
      while (usedSlugs.has(key) || CORE_KEYS.includes(key)) { key = `${base}_${n++}`; hadDuplicateSuffix = true }
      usedSlugs.add(key)
    }

    sections.push({ key, label: cleanLabel, core })
    changed = true
    return `[${key}] ${cleanLabel}`
  })

  const CONTENT_ONLY = { sections: [{ key: 'content', label: 'Session Content', core: true }], prompt: tpl.prompt, changed: false, detected: 0 }

  if (sections.length === 0) {
    // No detectable sections -> whole note flows into Session Content, as today.
    return CONTENT_ONLY
  }
  if (sections.length > MAX_SECTIONS || hadDuplicateSuffix) {
    // Long-form report / concatenated multi-part template -> keep as one
    // document (unchanged from today) rather than exploding into many fields.
    return { ...CONTENT_ONLY, capped: sections.length }
  }

  return { sections, prompt: outLines.join('\n'), changed, detected: sections.length }
}

const raw = readFileSync(FILE, 'utf8')
const data = JSON.parse(raw)

let rewritten = 0
let contentOnly = 0
let capped = 0
const report = []

for (const tpl of data) {
  const res = annotate(tpl)
  tpl.sections = res.sections
  tpl.prompt = res.prompt
  if (res.changed) rewritten++
  if (res.detected === 0) contentOnly++
  if (res.capped) capped++
  report.push({
    id: tpl.id,
    title: tpl.title,
    type: tpl.tplType,
    n: res.sections.length,
    changed: res.changed,
    capped: res.capped,
    sections: res.sections.map(s => (s.core ? s.key : `*${s.key}`)).join(', '),
  })
}

// ── Report ──────────────────────────────────────────────────────────────
console.log(`\nTemplates: ${data.length} | rewritten: ${rewritten} | content-only: ${contentOnly} | capped(long-form): ${capped}\n`)
for (const r of report) {
  const flag = r.capped ? 'X' : (r.changed ? ' ' : (r.n === 1 ? 'C' : '='))
  console.log(`${flag} ${String(r.id).padStart(3)} [${r.type[0]}] n=${String(r.n).padStart(2)}${r.capped ? ` (was ${r.capped})` : ''}  ${r.title}`)
  console.log(`        ${r.sections}`)
}
console.log('\n(* = extra section | C = content-only (no headings) | X = capped long-form -> content-only | = = already marked)')

if (!DRY) {
  writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n', 'utf8')
  console.log(`\nWrote ${FILE}`)
} else {
  console.log('\n[dry run — no file written]')
}
