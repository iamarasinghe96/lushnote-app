// A tiny registry so a page (e.g. the edit screen) can tell the pull-to-refresh
// gesture that reloading right now would lose in-progress work — an unsaved
// letter (letters are never persisted to Firestore) or a note mid-save. The
// gesture confirms with the doctor before reloading when this returns true.
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
