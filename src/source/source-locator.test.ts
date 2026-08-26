import type {
  EditorPosition,
  MarkdownSectionInformation,
  Editor as ObsidianEditor,
} from 'obsidian';
import { Editor } from 'obsidian-test-mocks/obsidian';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings.js';
import { SourceLocator } from './source-locator.js';

const blockA = ['```tabs', 'tab: A', 'one', '```'].join('\n');

class RealisticEditor extends Editor {
  constructor(value: string) {
    super();
    this.setValue(value);
  }

  override getLine(line: number): string {
    return this.getValue().split(/\r?\n/)[line] ?? '';
  }

  override lineCount(): number {
    return this.getValue().split(/\r?\n/).length;
  }

  override offsetToPos(offset: number): EditorPosition {
    const value = this.getValue();
    const target = Math.max(0, Math.min(offset, value.length));
    let line = 0;
    let lineStart = 0;
    for (let index = 0; index < target; index += 1) {
      if (value[index] === '\n') {
        line += 1;
        lineStart = index + 1;
      }
    }
    const rawCh = target - lineStart;
    return { line, ch: Math.min(rawCh, this.getLine(line).length) };
  }

  override posToOffset(position: EditorPosition): number {
    const value = this.getValue();
    let lineStart = 0;
    for (let line = 0; line < position.line; line += 1) {
      const newline = value.indexOf('\n', lineStart);
      if (newline === -1) {
        return value.length;
      }
      lineStart = newline + 1;
    }
    return lineStart + Math.min(Math.max(position.ch, 0), this.getLine(position.line).length);
  }

  asEditor(): ObsidianEditor {
    return this.asOriginalType__();
  }
}

function section(text: string, lineStart: number, lineEnd: number): MarkdownSectionInformation {
  return { text, lineStart, lineEnd };
}

function locatorFor(
  editor: RealisticEditor,
  text: string,
  lineStart: number,
  lineEnd: number,
): SourceLocator {
  const locator = SourceLocator.fromSection(
    editor.asEditor(),
    section(text, lineStart, lineEnd),
    DEFAULT_SETTINGS,
  );
  if (locator === null) {
    throw new Error('Expected a source locator');
  }
  return locator;
}

describe('SourceLocator.fromSection', () => {
  it('captures the exact full block and inclusive source range', () => {
    const editor = new RealisticEditor(`before\n${blockA}\nafter`);
    const locator = locatorFor(editor, blockA, 1, 4);

    expect(locator.locate()).toMatchObject({
      snapshot: blockA,
      range: { from: { line: 1, ch: 0 }, to: { line: 4, ch: 3 } },
    });
  });

  it('accepts Live Preview section metadata whose text contains the whole note', () => {
    const source = `heading\n\n${blockA}\ntrailing`;
    const editor = new RealisticEditor(source);

    const locator = locatorFor(editor, `${source}\n`, 2, 5);

    expect(locator.locate()).toMatchObject({
      snapshot: blockA,
      range: { from: { line: 2, ch: 0 }, to: { line: 5, ch: 3 } },
    });
  });

  it.each([
    [section(blockA, -1, 3), 'negative'],
    [section(blockA, 0.5, 3), 'fractional'],
    [section(blockA, 3, 2), 'inverted'],
    [section(blockA, 0, 9), 'past end'],
  ])('rejects an invalid section range (%s)', (info) => {
    const editor = new RealisticEditor(blockA);

    expect(SourceLocator.fromSection(editor.asEditor(), info, DEFAULT_SETTINGS)).toBeNull();
  });

  it('rejects stale section text and text that is not a complete tabs fence', () => {
    const editor = new RealisticEditor(blockA);

    expect(
      SourceLocator.fromSection(editor.asEditor(), section(`${blockA}!`, 0, 3), DEFAULT_SETTINGS),
    ).toBeNull();
    expect(
      SourceLocator.fromSection(
        editor.asEditor(),
        section(['```tabs', 'tab: A', 'one'].join('\n'), 0, 2),
        DEFAULT_SETTINGS,
      ),
    ).toBeNull();
  });

  it('uses exact whole-line boundaries and preserves CRLF positions', () => {
    const crlfBlock = blockA.replaceAll('\n', '\r\n');
    const editor = new RealisticEditor(`lead\r\n${crlfBlock}\r\ntail`);
    const locator = locatorFor(editor, crlfBlock, 1, 4);

    expect(locator.locate()).toMatchObject({
      snapshot: crlfBlock,
      range: { from: { line: 1, ch: 0 }, to: { line: 4, ch: 3 } },
    });
  });
});

describe('SourceLocator.locate', () => {
  it('relocates the snapshot after source is inserted above it', () => {
    const editor = new RealisticEditor(`before\n${blockA}\nafter`);
    const locator = locatorFor(editor, blockA, 1, 4);

    editor.setValue(`inserted\nbefore\n${blockA}\nafter`);

    expect(locator.locate()).toMatchObject({
      snapshot: blockA,
      range: { from: { line: 2, ch: 0 }, to: { line: 5, ch: 3 } },
    });
  });

  it('returns the only whole-line copy even when all surrounding lines changed', () => {
    const editor = new RealisticEditor(`a\nb\n${blockA}\nc\nd`);
    const locator = locatorFor(editor, blockA, 2, 5);

    editor.setValue(`changed one\nchanged two\n${blockA}\nchanged three\nchanged four`);

    expect(locator.locate()?.snapshot).toBe(blockA);
  });

  it('rejects deleted, partial-line, and detached snapshots', () => {
    const editor = new RealisticEditor(`before\n${blockA}\nafter`);
    const locator = locatorFor(editor, blockA, 1, 4);

    editor.setValue('before\nafter');
    expect(locator.locate()).toBeNull();
    editor.setValue(`before\nprefix${blockA}\nafter`);
    expect(locator.locate()).toBeNull();
    editor.setValue(`before\n${blockA}suffix\nafter`);
    expect(locator.locate()).toBeNull();
  });

  it('uses two lines on each side to distinguish identical blocks', () => {
    const editor = new RealisticEditor(
      `first-one\nfirst-two\n${blockA}\nfirst-after\ncommon\nsecond-one\nsecond-two\n${blockA}\nsecond-after\ncommon`,
    );
    const locator = locatorFor(editor, blockA, 10, 13);

    editor.setValue(
      `second-one\nsecond-two\n${blockA}\nsecond-after\ncommon\nfirst-one\nfirst-two\n${blockA}\nfirst-after\ncommon`,
    );

    expect(locator.locate()?.range.from).toStrictEqual({ line: 2, ch: 0 });
  });

  it('rejects anchor-indistinguishable identical blocks instead of trusting old offsets', () => {
    const repeated = `same-one\nsame-two\n${blockA}\nsame-after\nsame-last`;
    const editor = new RealisticEditor(repeated);
    const locator = locatorFor(editor, blockA, 2, 5);

    editor.setValue(`${repeated}\n${repeated}`);

    expect(locator.locate()).toBeNull();
  });
});

describe('SourceLocator.accept', () => {
  it('updates the snapshot, range, parsed block, and anchors for another save', () => {
    const editor = new RealisticEditor(`old-before\n${blockA}\nold-after`);
    const locator = locatorFor(editor, blockA, 1, 4);
    const replacement = ['```tabs', 'tab: A', 'changed', '```'].join('\n');
    editor.setValue(`new-before\n${replacement}\nnew-after`);
    const range = { from: { line: 1, ch: 0 }, to: { line: 4, ch: 3 } };

    locator.accept(replacement, range);
    editor.setValue(`old-before\n${replacement}\nold-after\nnew-before\n${replacement}\nnew-after`);

    expect(locator.locate()).toMatchObject({
      snapshot: replacement,
      range: { from: { line: 7, ch: 0 }, to: { line: 10, ch: 3 } },
      block: { document: { tabs: [{ title: 'A', content: 'changed\n' }] } },
    });
  });

  it('does not accept a mismatched range or invalid full block', () => {
    const editor = new RealisticEditor(`before\n${blockA}\nafter`);
    const locator = locatorFor(editor, blockA, 1, 4);
    const wrongRange = { from: { line: 0, ch: 0 }, to: { line: 0, ch: 6 } };

    locator.accept(blockA, wrongRange);
    editor.setValue(`before\n${blockA}\nafter\nother-before\n${blockA}\nother-after`);
    expect(locator.locate()?.range.from).toStrictEqual({ line: 1, ch: 0 });

    editor.setValue(`before\nnot a block\nafter`);
    locator.accept('not a block', { from: { line: 1, ch: 0 }, to: { line: 1, ch: 11 } });
    expect(locator.locate()).toBeNull();
  });
});
