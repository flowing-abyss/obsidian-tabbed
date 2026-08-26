export interface TextSelection {
  readonly from: number;
  readonly to: number;
}

export interface TextTransformInput {
  readonly text: string;
  readonly selection: TextSelection;
}

export interface TextTransformResult {
  readonly text: string;
  readonly selection: TextSelection;
}

interface TextEdit {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

interface SelectedLine {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

function wrapSelection(
  input: TextTransformInput,
  before: string,
  after: string,
): TextTransformResult {
  const { text, selection } = input;
  const selected = text.slice(selection.from, selection.to);
  const wrappedFrom = selection.from - before.length;
  const wrappedTo = selection.to + after.length;
  if (
    wrappedFrom >= 0 &&
    text.slice(wrappedFrom, selection.from) === before &&
    text.slice(selection.to, wrappedTo) === after
  ) {
    return {
      text: `${text.slice(0, wrappedFrom)}${selected}${text.slice(wrappedTo)}`,
      selection: { from: wrappedFrom, to: wrappedFrom + selected.length },
    };
  }
  return {
    text: `${text.slice(0, selection.from)}${before}${selected}${after}${text.slice(selection.to)}`,
    selection: {
      from: selection.from + before.length,
      to: selection.to + before.length,
    },
  };
}

export function toggleBold(input: TextTransformInput): TextTransformResult {
  return wrapSelection(input, '**', '**');
}

export function toggleItalic(input: TextTransformInput): TextTransformResult {
  return wrapSelection(input, '*', '*');
}

export function toggleUnderline(input: TextTransformInput): TextTransformResult {
  return wrapSelection(input, '<u>', '</u>');
}

export function toggleStrike(input: TextTransformInput): TextTransformResult {
  return wrapSelection(input, '~~', '~~');
}

function selectedLines(input: TextTransformInput): readonly SelectedLine[] {
  const { text, selection } = input;
  const firstFrom = text.lastIndexOf('\n', Math.max(0, selection.from - 1)) + 1;
  const finalPosition = selection.to > selection.from ? selection.to - 1 : selection.to;
  const finalNewline = text.indexOf('\n', finalPosition);
  const finalTo = finalNewline === -1 ? text.length : finalNewline;
  const lines: SelectedLine[] = [];
  let from = firstFrom;
  while (from <= finalTo) {
    const newline = text.indexOf('\n', from);
    const to = newline === -1 || newline > finalTo ? finalTo : newline;
    lines.push({ from, to, text: text.slice(from, to) });
    if (newline === -1 || newline >= finalTo) {
      break;
    }
    from = newline + 1;
  }
  return lines;
}

function mapPosition(position: number, edits: readonly TextEdit[]): number {
  let mapped = position;
  for (const edit of edits) {
    if (position < edit.from) {
      continue;
    }
    const removed = edit.to - edit.from;
    if (position <= edit.to) {
      mapped += edit.insert.length - (position - edit.from);
    } else {
      mapped += edit.insert.length - removed;
    }
  }
  return mapped;
}

function applyEdits(input: TextTransformInput, edits: readonly TextEdit[]): TextTransformResult {
  let text = input.text;
  for (const edit of [...edits].reverse()) {
    text = `${text.slice(0, edit.from)}${edit.insert}${text.slice(edit.to)}`;
  }
  return {
    text,
    selection: {
      from: mapPosition(input.selection.from, edits),
      to: mapPosition(input.selection.to, edits),
    },
  };
}

function toggleLinePrefixes(
  input: TextTransformInput,
  prefixFor: (index: number) => string,
  prefixPattern: RegExp,
): TextTransformResult {
  const lines = selectedLines(input);
  const remove = lines.every((line) => prefixPattern.test(line.text));
  const edits = lines.map((line, index): TextEdit => {
    const match = remove ? prefixPattern.exec(line.text) : null;
    return {
      from: line.from,
      to: line.from + (match?.[0].length ?? 0),
      insert: remove ? '' : prefixFor(index),
    };
  });
  return applyEdits(input, edits);
}

export function toggleUnorderedList(input: TextTransformInput): TextTransformResult {
  return toggleLinePrefixes(input, () => '- ', /^[-*+] /);
}

export function toggleOrderedList(input: TextTransformInput): TextTransformResult {
  return toggleLinePrefixes(input, (index) => `${index + 1}. `, /^\d+\. /);
}

export function toggleTaskList(input: TextTransformInput): TextTransformResult {
  return toggleLinePrefixes(input, () => '- [ ] ', /^[-*+] \[[ xX]\] /);
}

export function toggleQuote(input: TextTransformInput): TextTransformResult {
  return toggleLinePrefixes(input, () => '> ', /^> /);
}

export function indentSelection(input: TextTransformInput, tabSize: number): TextTransformResult {
  const indent = ' '.repeat(tabSize);
  return applyEdits(
    input,
    selectedLines(input).map((line) => ({ from: line.from, to: line.from, insert: indent })),
  );
}

export function outdentSelection(input: TextTransformInput, tabSize: number): TextTransformResult {
  return applyEdits(
    input,
    selectedLines(input).map((line) => {
      const spaces = /^ +/.exec(line.text)?.[0].length ?? 0;
      const length = line.text.startsWith('\t') ? 1 : Math.min(tabSize, spaces);
      return { from: line.from, to: line.from + length, insert: '' };
    }),
  );
}

export function insertCodeBlock(input: TextTransformInput): TextTransformResult {
  const selected = input.text.slice(input.selection.from, input.selection.to);
  const longestRun = Math.max(0, ...[...selected.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return wrapSelection(input, `${fence}\n`, `\n${fence}`);
}

export function insertCallout(input: TextTransformInput): TextTransformResult {
  const selected = input.text.slice(input.selection.from, input.selection.to);
  const quoted = selected.replaceAll('\n', '\n> ');
  const prefix = '> [!note]\n> ';
  return {
    text: `${input.text.slice(0, input.selection.from)}${prefix}${quoted}${input.text.slice(input.selection.to)}`,
    selection: {
      from: input.selection.from + prefix.length,
      to: input.selection.from + prefix.length + quoted.length,
    },
  };
}

export function insertTable(input: TextTransformInput): TextTransformResult {
  const table = '| Column 1 | Column 2 |\n| --- | --- |\n|  |  |\n';
  const text = `${input.text.slice(0, input.selection.from)}${table}${input.text.slice(input.selection.to)}`;
  return {
    text,
    selection: {
      from: input.selection.from + 2,
      to: input.selection.from + 10,
    },
  };
}
