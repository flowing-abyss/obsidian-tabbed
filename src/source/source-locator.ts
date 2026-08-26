import type { Editor, EditorRange, MarkdownSectionInformation } from 'obsidian';
import type { TabbedSettings } from '../settings.js';
import type { FullTabsBlock } from '../tabs/tab-model.js';
import { parseFullTabsBlock } from '../tabs/tab-parser.js';

export interface LocatedTabsBlock {
  readonly snapshot: string;
  readonly range: EditorRange;
  readonly block: FullTabsBlock;
}

interface SourceLine {
  readonly from: number;
  readonly contentTo: number;
  readonly text: string;
}

interface Anchors {
  readonly before: readonly string[];
  readonly after: readonly string[];
}

interface Candidate {
  readonly from: number;
  readonly to: number;
}

interface LocatorState {
  readonly snapshot: string;
  readonly range: EditorRange;
  readonly block: FullTabsBlock;
  readonly anchors: Anchors;
}

function sourceLines(source: string): readonly SourceLine[] {
  const lines: SourceLine[] = [];
  let from = 0;
  while (from < source.length) {
    const newline = source.indexOf('\n', from);
    if (newline === -1) {
      lines.push({ from, contentTo: source.length, text: source.slice(from) });
      return lines;
    }
    const contentTo = newline > from && source[newline - 1] === '\r' ? newline - 1 : newline;
    lines.push({ from, contentTo, text: source.slice(from, contentTo) });
    from = newline + 1;
  }
  if (source.length === 0 || source.endsWith('\n')) {
    lines.push({ from, contentTo: from, text: '' });
  }
  return lines;
}

function isWholeLine(source: string, from: number, to: number): boolean {
  const startsAtBoundary = from === 0 || source[from - 1] === '\n';
  const endsAtBoundary =
    to === source.length || source[to] === '\n' || source.slice(to, to + 2) === '\r\n';
  return startsAtBoundary && endsAtBoundary;
}

function occurrences(source: string, snapshot: string): readonly Candidate[] {
  const candidates: Candidate[] = [];
  let from = source.indexOf(snapshot);
  while (from !== -1) {
    const to = from + snapshot.length;
    if (isWholeLine(source, from, to)) {
      candidates.push({ from, to });
    }
    from = source.indexOf(snapshot, from + 1);
  }
  return candidates;
}

function lineIndexAt(lines: readonly SourceLine[], offset: number, useContentEnd: boolean): number {
  return lines.findIndex((line) => offset === (useContentEnd ? line.contentTo : line.from));
}

function anchorsAt(source: string, candidate: Candidate): Anchors | null {
  const lines = sourceLines(source);
  const firstLine = lineIndexAt(lines, candidate.from, false);
  const lastLine = lineIndexAt(lines, candidate.to, true);
  if (firstLine === -1 || lastLine === -1) {
    return null;
  }
  return {
    before: lines.slice(Math.max(0, firstLine - 2), firstLine).map((line) => line.text),
    after: lines.slice(lastLine + 1, lastLine + 3).map((line) => line.text),
  };
}

function sameAnchors(left: Anchors, right: Anchors): boolean {
  const before = right.before.slice(-left.before.length);
  const after = right.after.slice(0, left.after.length);
  return (
    before.length === left.before.length &&
    after.length === left.after.length &&
    left.before.every((anchor, index) => anchor === before[index]) &&
    left.after.every((anchor, index) => anchor === after[index])
  );
}

function validSection(editor: Editor, info: MarkdownSectionInformation): EditorRange | null {
  const { lineStart, lineEnd } = info;
  if (
    !Number.isInteger(lineStart) ||
    !Number.isInteger(lineEnd) ||
    lineStart < 0 ||
    lineEnd < lineStart ||
    lineEnd >= editor.lineCount()
  ) {
    return null;
  }
  return {
    from: { line: lineStart, ch: 0 },
    to: { line: lineEnd, ch: editor.getLine(lineEnd).length },
  };
}

export class SourceLocator {
  private readonly settings: TabbedSettings;
  private state: LocatorState;

  private constructor(
    readonly editor: Editor,
    settings: TabbedSettings,
    state: LocatorState,
  ) {
    this.settings = { ...settings };
    this.state = state;
  }

  static fromSection(
    editor: Editor,
    info: MarkdownSectionInformation,
    settings: TabbedSettings,
  ): SourceLocator | null {
    const range = validSection(editor, info);
    if (range === null || editor.getRange(range.from, range.to) !== info.text) {
      return null;
    }
    const block = parseFullTabsBlock(info.text, settings);
    if (block === null) {
      return null;
    }
    const candidate = { from: editor.posToOffset(range.from), to: editor.posToOffset(range.to) };
    const anchors = anchorsAt(editor.getValue(), candidate);
    return anchors === null
      ? null
      : new SourceLocator(editor, settings, { snapshot: info.text, range, block, anchors });
  }

  locate(): LocatedTabsBlock | null {
    const source = this.editor.getValue();
    const hintedOffset = this.editor.posToOffset(this.state.range.from);
    const found = [...occurrences(source, this.state.snapshot)].sort(
      (left, right) => Math.abs(left.from - hintedOffset) - Math.abs(right.from - hintedOffset),
    );
    let candidate = found.length === 1 ? found[0] : undefined;
    if (found.length > 1) {
      const anchored = found.filter((item) => {
        const current = anchorsAt(source, item);
        return current !== null && sameAnchors(this.state.anchors, current);
      });
      candidate = anchored.length === 1 ? anchored[0] : undefined;
    }
    if (candidate === undefined) {
      return null;
    }
    return {
      snapshot: this.state.snapshot,
      range: {
        from: this.editor.offsetToPos(candidate.from),
        to: this.editor.offsetToPos(candidate.to),
      },
      block: this.state.block,
    };
  }

  accept(replacement: string, range: EditorRange): void {
    if (this.editor.getRange(range.from, range.to) !== replacement) {
      return;
    }
    const block = parseFullTabsBlock(replacement, this.settings);
    if (block === null) {
      return;
    }
    const candidate = {
      from: this.editor.posToOffset(range.from),
      to: this.editor.posToOffset(range.to),
    };
    const anchors = anchorsAt(this.editor.getValue(), candidate);
    if (anchors === null) {
      return;
    }
    this.state = { snapshot: replacement, range, block, anchors };
  }
}
