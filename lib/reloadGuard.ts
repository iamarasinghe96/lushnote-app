// A tiny registry so a page (e.g. the edit screen) can tell the pull-to-refresh
// gesture that reloading right now would lose in-progress work — a letter or note
// with edits not yet flushed to Firestore (letters autosave once they name a
// patient, but a brand-new one or an edit mid-debounce is still in memory), or a
// save in flight. The gesture confirms with the doctor before reloading when this
// returns true.
let guard: (() => boolean) | null = null

export function registerReloadGuard(fn: (() => boolean) | null) {
  guard = fn
}

export function isReloadRisky(): boolean {
  try {
    return guard ? guard() : false
  } catch {
    return false
  }
}
