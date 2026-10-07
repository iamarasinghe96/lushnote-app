// How many of a doctor's notes the app loads into Patients, History, the
// editor's patient index and the assistant: the most recently edited ones.
// Anything older stays in Firestore but drops out of those lists. The admin
// Overview warns once a doctor gets near it, because the fix (a lightweight
// notes index) is a design change to schedule before anyone reaches it.
export const NOTES_LIST_LIMIT = 200

/** When the admin Overview starts warning. */
export const NOTES_LIST_WARN_AT = 150
