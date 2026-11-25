// Text measurements shared by the Utility Desk, kept browser-independent so the
// rules can be tested directly.
//
// Line count is the number of lines that hold content plus the blank lines
// between them: the final line terminator does not create a line of its own, and
// empty input has no lines at all.
//
//   ''        → 0
//   'a'       → 1
//   'a\n'     → 1
//   'a\nb'    → 2
//   'a\n\n'   → 2   (one content line, one trailing blank line)
//   'a\n\nb'  → 3   (the blank line between them is preserved)
// CRLF, LF and lone CR are all line terminators.
export function countLines(text) {
  const source = String(text ?? '');
  if (!source) return 0;
  const lines = source.split(/\r\n|\r|\n/);
  // A trailing terminator leaves one empty element that is not its own line.
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.length;
}
