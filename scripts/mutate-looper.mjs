#!/usr/bin/env node
/**
 * Mutation testing for the looper modules.
 *
 * AGENTS.md asks a reviewer to "inject deliberate bugs (mutation testing) to see
 * whether the tests catch them", so this script does that repeatably.
 *
 * How it works: the repository is copied once into a temporary directory, every
 * mutant is written into that copy, `node --test tests/*.test.mjs` is run there,
 * and the original file is restored after each run. The real working tree is
 * never mutated; the only file written outside the temp directory is the report.
 *
 * Usage:
 *   node scripts/mutate-looper.mjs
 *   node scripts/mutate-looper.mjs --file assets/js/loop-math.js --limit 5
 *   node scripts/mutate-looper.mjs --limit 40 --timeout 60000
 *
 * Options:
 *   --file <path>    Only mutate this target (repeatable or comma separated).
 *   --limit <n>      Stop after n mutants.
 *   --timeout <ms>   Per-run test timeout. Default 60000.
 *   --report <path>  Report path. Default mutation-report.json.
 *   --keep           Keep the temporary copy (printed at the end).
 *
 * Result values: "killed" (tests failed or timed out), "survived" (tests still
 * passed), "invalid" (the mutant did not parse, so it proves nothing).
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = [
  'assets/js/looper.js',
  'assets/js/loop-math.js',
  'assets/js/looper-view.js',
  'assets/js/looper-ui.js',
];
const DEFAULT_TIMEOUT_MS = 60000;
const REPORT_NAME = 'mutation-report.json';
// Numbers worth nudging by one in timing and layout code.
const WATCHED_NUMBERS = new Set([0, 1, 4, 16, 5]);

function fail(message) {
  console.error(`mutate-looper: ${message}`);
  process.exit(1);
}

// --- Command line --------------------------------------------------------------

function parseArgs(argv) {
  const options = { limit: Infinity, files: [], timeout: DEFAULT_TIMEOUT_MS, keep: false, report: join(REPO_ROOT, REPORT_NAME) };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const cut = arg.indexOf('=');
    const flag = cut === -1 ? arg : arg.slice(0, cut);
    const inline = cut === -1 ? undefined : arg.slice(cut + 1);
    const value = () => {
      if (inline !== undefined) return inline;
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) fail(`${flag} needs a value.`);
      index += 1;
      return next;
    };

    if (flag === '--file') {
      for (const part of value().split(',')) {
        const cleaned = part.trim().replace(/\\/g, '/');
        if (cleaned) options.files.push(cleaned);
      }
    } else if (flag === '--limit') {
      const limit = Number(value());
      if (!Number.isInteger(limit) || limit < 1) fail('--limit needs a whole number of 1 or more.');
      options.limit = limit;
    } else if (flag === '--timeout') {
      const timeout = Number(value());
      if (!Number.isInteger(timeout) || timeout < 1) fail('--timeout needs a whole number of milliseconds.');
      options.timeout = timeout;
    } else if (flag === '--report') {
      options.report = resolve(value());
    } else if (flag === '--keep') {
      options.keep = true;
    } else if (flag === '--help' || flag === '-h') {
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*?/, ''));
      process.exit(0);
    } else {
      fail(`unknown option ${arg}. Try --help.`);
    }
  }
  return options;
}

function resolveTargets(requested) {
  if (!requested.length) return TARGETS;
  const chosen = [];
  for (const want of requested) {
    const match = TARGETS.find(target => target === want || target.endsWith(`/${want}`) || basename(target) === basename(want));
    if (!match) fail(`--file ${want} is not a looper target. Choose from: ${TARGETS.join(', ')}`);
    if (!chosen.includes(match)) chosen.push(match);
  }
  return chosen;
}

// --- A tiny lexer, so mutations only touch code --------------------------------
// Strings, template literals, comments and regular expressions are masked out.
// Mutating inside a string produces a mutant that can never be killed, which
// would pollute the survivor list with noise.

const REGEX_PREFIX = new Set(['(', '[', '{', '=', ',', ':', ';', '!', '&', '|', '?', '+', '-', '*', '%', '<', '>', '~', '^']);
const REGEX_PREFIX_WORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'case', 'do', 'else', 'yield', 'await']);

function codeMask(source) {
  const mask = new Uint8Array(source.length);
  const length = source.length;
  let index = 0;
  let previous = '';
  let word = '';

  const skipQuoted = (start, quote) => {
    let cursor = start + 1;
    while (cursor < length) {
      if (source[cursor] === '\\') { cursor += 2; continue; }
      if (source[cursor] === quote) return cursor + 1;
      cursor += 1;
    }
    return length;
  };

  const skipTemplate = start => {
    let cursor = start + 1;
    while (cursor < length) {
      if (source[cursor] === '\\') { cursor += 2; continue; }
      if (source[cursor] === '`') return cursor + 1;
      cursor += 1;
    }
    return length;
  };

  const skipRegex = start => {
    let cursor = start + 1;
    let inClass = false;
    while (cursor < length) {
      const char = source[cursor];
      if (char === '\\') { cursor += 2; continue; }
      if (char === '[') inClass = true;
      else if (char === ']') inClass = false;
      else if (char === '/' && !inClass) return cursor + 1;
      else if (char === '\n') return start; // not a regex after all
      cursor += 1;
    }
    return length;
  };

  while (index < length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === '/' && next === '/') {
      index += 2;
      while (index < length && source[index] !== '\n') index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      index += 2;
      while (index < length && !(source[index] === '*' && source[index + 1] === '/')) index += 1;
      index += 2;
      continue;
    }
    if (char === '"' || char === "'") { index = skipQuoted(index, char); previous = '"'; word = ''; continue; }
    if (char === '`') { index = skipTemplate(index); previous = '`'; word = ''; continue; }
    if (char === '/' && (previous === '' || REGEX_PREFIX.has(previous) || REGEX_PREFIX_WORDS.has(word))) {
      index = skipRegex(index);
      previous = '/';
      word = '';
      continue;
    }

    mask[index] = 1;
    if (!/\s/.test(char)) {
      if (/[A-Za-z0-9_$]/.test(char)) word += char;
      else word = '';
      previous = char;
    }
    index += 1;
  }
  return mask;
}

// --- Mutant generation ----------------------------------------------------------

const COMPARISONS = [
  ['===', '!=='],
  ['!==', '==='],
  ['<=', '<'],
  ['>=', '>'],
  ['<', '<='],
  ['>', '>='],
];

function collectMutants(source) {
  const mask = codeMask(source);
  const length = source.length;
  const mutants = [];
  const seen = new Set();

  const lineStarts = [0];
  for (let index = 0; index < length; index += 1) if (source[index] === '\n') lineStarts.push(index + 1);
  const lineOf = index => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (lineStarts[middle] <= index) low = middle;
      else high = middle - 1;
    }
    return low;
  };

  const add = (start, span, replacement, kind) => {
    const key = `${start}:${span}:${replacement}`;
    if (seen.has(key)) return;
    seen.add(key);

    const line = lineOf(start);
    const lineStart = lineStarts[line];
    const lineEnd = line + 1 < lineStarts.length ? lineStarts[line + 1] : length;
    const text = source.slice(lineStart, lineEnd).replace(/\r?\n$/, '');
    const offset = start - lineStart;
    const mutated = text.slice(0, offset) + replacement + text.slice(offset + span);
    mutants.push({ start, span, replacement, kind, line: line + 1, original: text, mutated });
  };

  // 1. Comparison operators.
  for (let index = 0; index < length; index += 1) {
    if (!mask[index]) continue;
    for (const [from, to] of COMPARISONS) {
      if (!source.startsWith(from, index)) continue;
      let insideCode = true;
      for (let offset = 0; offset < from.length; offset += 1) if (!mask[index + offset]) insideCode = false;
      if (!insideCode) continue;
      // `=>` is an arrow, not a comparison.
      if (from === '>' && source[index - 1] === '=') break;
      add(index, from.length, to, `comparison ${from} -> ${to}`);
      index += from.length - 1;
      break;
    }
  }

  // 2. Arithmetic: + becomes - and * becomes /.
  for (let index = 0; index < length; index += 1) {
    if (!mask[index]) continue;
    const char = source[index];
    if (char !== '+' && char !== '*') continue;
    const before = source[index - 1] ?? '';
    const after = source[index + 1] ?? '';
    if (before === char || after === char) continue; // ++ or **
    if (before === '=' || after === '=') continue; // +=, *=, ==
    add(index, 1, char === '+' ? '-' : '/', `arithmetic ${char} -> ${char === '+' ? '-' : '/'}`);
  }

  // 3. Numeric constants from the watch list, nudged by one.
  for (let index = 0; index < length; index += 1) {
    if (!mask[index]) continue;
    if (!/[0-9]/.test(source[index])) continue;
    const before = source[index - 1] ?? '';
    if (/[A-Za-z0-9_$.]/.test(before)) continue;

    let end = index;
    while (end < length && /[0-9]/.test(source[end])) end += 1;
    const token = source.slice(index, end);
    const after = source[end] ?? '';
    if (/[A-Za-z0-9_$.]/.test(after)) { index = end - 1; continue; } // 1.5, 1e3, 1n

    const value = Number(token);
    if (WATCHED_NUMBERS.has(value)) add(index, token.length, String(value + 1), `number ${token} -> ${value + 1}`);
    index = end - 1;
  }

  // 4. true and false.
  for (const [from, to] of [['true', 'false'], ['false', 'true']]) {
    for (const match of source.matchAll(new RegExp(`\\b${from}\\b`, 'g'))) {
      if (!mask[match.index]) continue;
      add(match.index, from.length, to, `boolean ${from} -> ${to}`);
    }
  }

  // 5. Delete a whole statement line.
  for (let line = 0; line < lineStarts.length; line += 1) {
    const start = lineStarts[line];
    const end = line + 1 < lineStarts.length ? lineStarts[line + 1] : length;
    const text = source.slice(start, end);
    const trimmed = text.trim();
    if (!trimmed.endsWith(';')) continue;
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
    const firstCode = start + text.search(/\S/);
    if (firstCode < 0 || !mask[firstCode]) continue;
    add(start, end - start, '', 'delete statement');
  }

  // 6. Drop a return value, keeping the early exit.
  for (const match of source.matchAll(/^([ \t]*)return\s+([^;\n]+);/gm)) {
    if (!mask[match.index]) continue;
    add(match.index, match[0].length, `${match[1]}return;`, 'remove return value');
  }

  return mutants;
}

const applyMutant = (source, mutant) => source.slice(0, mutant.start) + mutant.replacement + source.slice(mutant.start + mutant.span);

// --- Running -------------------------------------------------------------------

function copyRepository(destination) {
  const skip = new Set(['.git', 'node_modules', 'dist', REPORT_NAME]);
  cpSync(REPO_ROOT, destination, {
    recursive: true,
    filter: source => !skip.has(basename(source)),
  });
}

function testFilesIn(work) {
  const directory = join(work, 'tests');
  if (!existsSync(directory)) fail('the copy has no tests/ directory.');
  return readdirSync(directory).filter(name => name.endsWith('.test.mjs')).sort().map(name => join('tests', name));
}

function parses(work, target) {
  return spawnSync(process.execPath, ['--check', target], { cwd: work, encoding: 'utf8' }).status === 0;
}

function testsPass(work, tests, timeout) {
  const result = spawnSync(process.execPath, ['--test', ...tests], {
    cwd: work,
    encoding: 'utf8',
    timeout,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error?.code === 'ETIMEDOUT') return false; // a hang is a kill
  if (result.signal) return false;
  return result.status === 0;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const targets = resolveTargets(options.files);
  for (const target of targets) if (!existsSync(join(REPO_ROOT, target))) fail(`missing target ${target}`);

  const workRoot = mkdtempSync(join(tmpdir(), 'looper-mutants-'));
  const work = join(workRoot, 'repo');
  const results = [];
  let candidates = 0;
  let capped = false;

  try {
    copyRepository(work);
    const tests = testFilesIn(work);

    for (const target of targets) {
      const original = readFileSync(join(REPO_ROOT, target), 'utf8');
      const mutants = collectMutants(original);
      candidates += mutants.length;
      console.log(`\n${target}: ${mutants.length} candidate mutants`);

      const absolute = join(work, target);
      for (const mutant of mutants) {
        if (results.length >= options.limit) { capped = true; break; }

        writeFileSync(absolute, applyMutant(original, mutant));
        let result;
        try {
          if (!parses(work, target)) result = 'invalid';
          else result = testsPass(work, tests, options.timeout) ? 'survived' : 'killed';
        } finally {
          writeFileSync(absolute, original);
        }

        results.push({ file: target, line: mutant.line, original: mutant.original, mutated: mutant.mutated, result });
        console.log(`  ${result.padEnd(8)} ${target}:${mutant.line}  ${mutant.kind}`);
      }
      if (capped) break;
    }
  } finally {
    if (options.keep) console.log(`\nTemporary copy kept at ${work}`);
    else rmSync(workRoot, { recursive: true, force: true });
  }

  writeFileSync(options.report, `${JSON.stringify(results, null, 2)}\n`);

  const killed = results.filter(entry => entry.result === 'killed').length;
  const survived = results.filter(entry => entry.result === 'survived').length;
  const invalid = results.filter(entry => entry.result === 'invalid').length;
  const scored = killed + survived;

  console.log('\nMutation testing finished');
  console.log(`  mutants run      ${results.length}${capped ? ` (stopped at --limit ${options.limit}; ${candidates} candidates)` : ''}`);
  console.log(`  killed           ${killed}`);
  console.log(`  survived         ${survived}`);
  console.log(`  invalid          ${invalid} (did not parse, not counted as killed)`);
  if (scored) console.log(`  mutation score   ${Math.round((killed / scored) * 100)}% of parseable mutants killed`);

  if (survived) {
    console.log('\nSurvivors (tests did not notice these):');
    for (const entry of results.filter(item => item.result === 'survived')) {
      console.log(`  ${entry.file}:${entry.line}  ${entry.original.trim()}  =>  ${entry.mutated.trim() || '(line deleted)'}`);
    }
  }

  console.log(`\nReport written to ${relative(process.cwd(), options.report) || options.report}`);
}

main();
