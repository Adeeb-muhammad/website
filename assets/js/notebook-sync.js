// Decides what a Notes Canvas tab should do when another tab writes the same
// storage key. Browser-independent so the rule can be tested directly.
//
// 'ignore' — not our key, a cleared value, or a write of the value this tab
//            already knows about (including its own save echoed back).
// 'warn'   — another tab wrote something new while this tab has unsaved work;
//            adopting it would silently throw that work away, so keep both and
//            tell the user instead.
// 'adopt'  — this tab is idle, so reloading the newer notebook loses nothing.
export function notebookSyncAction({ key, eventKey, incomingValue, currentValue, busy = false } = {}) {
  if (!key || eventKey !== key || !incomingValue) return 'ignore';
  if (incomingValue === currentValue) return 'ignore';
  return busy ? 'warn' : 'adopt';
}
