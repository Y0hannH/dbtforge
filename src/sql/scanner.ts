// Position scanning over dbt SQL, aware of the regions whose contents must never be read as
// structure: comments, string literals, bracketed identifiers and Jinja blocks.
//
// The CTE parser used to walk raw characters, which is fine for autocomplete — a wrong answer just
// means no suggestions. It is not fine for rewriting a query that will be sent to the warehouse: a
// parenthesis inside a comment or a `{{ ref(...) }}` would silently shift every offset. Everything
// here exists so that a rewrite can be refused when the structure isn't understood, rather than
// produced from a miscount.

/**
 * If a non-code region starts at `index`, returns the offset just past it; otherwise returns
 * `index` unchanged. Callers loop until the value stops moving, then read one character of code.
 */
export function skipNonCode(text: string, index: number): number {
  const pair = text.slice(index, index + 2);

  if (pair === '--') return endOfLine(text, index);
  if (pair === '/*') return skipBlockComment(text, index);
  if (pair === '{{') return skipUntil(text, index + 2, '}}');
  if (pair === '{%') return skipUntil(text, index + 2, '%}');
  if (pair === '{#') return skipUntil(text, index + 2, '#}');

  const char = text[index];
  if (char === "'" || char === '"') return skipQuoted(text, index, char);
  if (char === '[') return skipQuoted(text, index, ']');

  return index;
}

/** Advances past whitespace and every non-code region, to the next character that is real code. */
export function skipIgnorable(text: string, index: number): number {
  let i = index;
  for (;;) {
    while (i < text.length && /\s/.test(text[i])) i++;
    const next = skipNonCode(text, i);
    if (next === i) return i;
    i = next;
  }
}

/** Index of the `)` matching the `(` at `openIndex`, or -1 when the query is unbalanced. */
export function findMatchingParen(text: string, openIndex: number): number {
  let depth = 0;
  let i = openIndex;

  while (i < text.length) {
    const skipped = skipNonCode(text, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }

    if (text[i] === '(') depth++;
    else if (text[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }

  return -1;
}

/**
 * Index of the first occurrence of `word` (case-insensitive, whole word) that sits at parenthesis
 * depth 0 relative to `fromIndex`, or -1. Depth is what keeps an `order by` inside a window
 * function, or a `select` inside a subquery, from being mistaken for the statement's own.
 */
export function findTopLevelKeyword(
  text: string,
  word: string,
  fromIndex: number,
  toIndex: number = text.length
): number {
  let depth = 0;
  let i = fromIndex;

  while (i < toIndex) {
    const skipped = skipNonCode(text, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }

    const char = text[i];
    if (char === '(') {
      depth++;
      i++;
      continue;
    }
    if (char === ')') {
      depth--;
      i++;
      continue;
    }

    if (depth === 0 && matchesWordAt(text, i, word)) return i;
    i++;
  }

  return -1;
}

/** True when `word` occurs at `index` bounded by non-identifier characters on both sides. */
export function matchesWordAt(text: string, index: number, word: string): boolean {
  const candidate = text.slice(index, index + word.length);
  if (candidate.toLowerCase() !== word.toLowerCase()) return false;

  const before = text[index - 1];
  const after = text[index + word.length];
  return !isIdentifierChar(before) && !isIdentifierChar(after);
}

/** Splits on `separator` at parenthesis depth 0 only, ignoring separators inside non-code regions. */
export function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;

  while (i < text.length) {
    const skipped = skipNonCode(text, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }

    const char = text[i];
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
    i++;
  }

  parts.push(text.slice(start));
  return parts;
}

function isIdentifierChar(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_]/.test(char);
}

function endOfLine(text: string, index: number): number {
  const newline = text.indexOf('\n', index);
  return newline === -1 ? text.length : newline + 1;
}

// T-SQL block comments nest, unlike most dialects: `/* a /* b */ c */` is one comment, and
// stopping at the first `*/` would leave the scanner reading `c */` as code.
function skipBlockComment(text: string, index: number): number {
  let depth = 0;
  let i = index;

  while (i < text.length - 1) {
    const pair = text.slice(i, i + 2);
    if (pair === '/*') {
      depth++;
      i += 2;
      continue;
    }
    if (pair === '*/') {
      depth--;
      i += 2;
      if (depth === 0) return i;
      continue;
    }
    i++;
  }

  return text.length; // unterminated comment: everything after it is comment
}

/**
 * Skips a quoted run ending at `closer`, honouring the doubled-delimiter escape shared by SQL
 * string literals (`'it''s'`), quoted identifiers (`"a""b"`) and T-SQL brackets (`[a]]b]`).
 */
function skipQuoted(text: string, index: number, closer: string): number {
  let i = index + 1;

  while (i < text.length) {
    if (text[i] === closer) {
      if (text[i + 1] === closer) {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i++;
  }

  return text.length; // unterminated literal
}

function skipUntil(text: string, index: number, terminator: string): number {
  const found = text.indexOf(terminator, index);
  return found === -1 ? text.length : found + terminator.length;
}
