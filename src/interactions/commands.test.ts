import type { Command, Editor as ObsidianEditor } from 'obsidian';
import { Editor, Notice } from 'obsidian-test-mocks/obsidian';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type TabbedSettings } from '../settings.js';
import { createTabbedCommands, type TabbedCommandHost, wrapSelectionAsTabs } from './commands.js';

function settings(overrides: Partial<TabbedSettings> = {}): TabbedSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

function requiredCallback(command: Command): NonNullable<Command['callback']> {
  if (command.callback === undefined) {
    throw new Error(`Expected callback for ${command.id}`);
  }
  return command.callback;
}

function commandAt(commands: readonly Command[], index: number): Command {
  const command = commands[index];
  if (command === undefined) {
    throw new Error(`Expected command ${index}`);
  }
  return command;
}

function requiredEditorCallback(command: Command): NonNullable<Command['editorCallback']> {
  if (command.editorCallback === undefined) {
    throw new Error(`Expected editor callback for ${command.id}`);
  }
  return command.editorCallback;
}

class TestEditor extends Editor {
  asEditor(): ObsidianEditor {
    return this.asOriginalType__();
  }
}

function selectedEditor(selection: string): { editor: TestEditor; publicEditor: ObsidianEditor } {
  const editor = new TestEditor();
  editor.setValue(selection);
  editor.setSelection({ line: 0, ch: 0 }, editor.offsetToPos(selection.length));
  return { editor, publicEditor: editor.asEditor() };
}

describe('wrapSelectionAsTabs', () => {
  it('materializes current defaults for an empty selection', () => {
    expect(
      wrapSelectionAsTabs(
        '',
        settings({ separator: 'pane: ', defaultTitle: 'Start', defaultContent: 'Body' }),
      ),
    ).toBe(['```tabs', 'pane: Start', 'Body', '```'].join('\n'));
  });

  it('uses CRLF structure while preserving the selected bytes exactly', () => {
    const selection = 'first\r\nsecond\nthird';

    expect(wrapSelectionAsTabs(selection, settings())).toBe(
      '```tabs\r\ntab: New tab\r\nfirst\r\nsecond\nthird\r\n```',
    );
  });

  it('uses a leading configured separator as the complete inner source', () => {
    const selection = 'pane: Existing\nbody\n';

    expect(wrapSelectionAsTabs(selection, settings({ separator: 'pane: ' }))).toBe(
      '```tabs\npane: Existing\nbody\n```',
    );
  });

  it('chooses a longer backtick fence around nested fenced content', () => {
    const selection = ['before', '`````ts', 'const value = 1;', '`````', 'after'].join('\n');

    const wrapped = wrapSelectionAsTabs(selection, settings());

    expect(wrapped).toBe(
      [
        '``````tabs',
        'tab: New tab',
        'before',
        '`````ts',
        'const value = 1;',
        '`````',
        'after',
        '``````',
      ].join('\n'),
    );
    expect(wrapped).toContain(selection);
  });

  it('ignores tilde runs when choosing the backtick fence', () => {
    const selection = ['~~~~~~js', 'value()', '~~~~~~'].join('\n');

    expect(wrapSelectionAsTabs(selection, settings())).toBe(
      ['```tabs', 'tab: New tab', '~~~~~~js', 'value()', '~~~~~~', '```'].join('\n'),
    );
  });

  it('preserves whitespace-only selection as content instead of treating it as empty', () => {
    expect(wrapSelectionAsTabs('  ', settings({ defaultContent: 'unused' }))).toBe(
      ['```tabs', 'tab: New tab', '  ', '```'].join('\n'),
    );
  });
});

describe('createTabbedCommands', () => {
  it('returns registration-ready descriptors that mutate real editor text and refresh the host', async () => {
    const current = settings({
      separator: 'pane: ',
      defaultTitle: 'Fresh',
      defaultContent: 'Empty',
    });
    const host: TabbedCommandHost = {
      getSettings: () => current,
      refreshLiveBlocks: vi.fn(async () => undefined),
    };
    const commands = createTabbedCommands(host);
    const create = commandAt(commands, 0);
    const refresh = commandAt(commands, 1);
    const { editor, publicEditor } = selectedEditor('selected');
    const notice = vi.spyOn(Notice.prototype, 'constructor__');

    await requiredEditorCallback(create)(publicEditor, {} as never);
    await requiredCallback(refresh)();

    expect(create).toMatchObject({ id: 'create-tabs-block', name: 'Create tabs block' });
    expect(refresh).toMatchObject({ id: 'refresh-tab-contents', name: 'Refresh tab contents' });
    expect(editor.getValue()).toBe(['```tabs', 'pane: Fresh', 'selected', '```'].join('\n'));
    expect(host.refreshLiveBlocks).toHaveBeenCalledTimes(1);
    expect(notice.mock.calls.map(([message]) => message)).toStrictEqual([
      'Created tabs block.',
      'Refreshed tab contents.',
    ]);
  });

  it('reports each command failure exactly once with diagnostics', async () => {
    const notice = vi.spyOn(Notice.prototype, 'constructor__');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const host: TabbedCommandHost = {
      getSettings: () => settings(),
      refreshLiveBlocks: vi.fn(async () => {
        throw new Error('refresh rejected');
      }),
    };
    const commands = createTabbedCommands(host);
    const create = commandAt(commands, 0);
    const refresh = commandAt(commands, 1);
    const { editor, publicEditor } = selectedEditor('selected');
    vi.spyOn(editor, 'replaceSelection').mockImplementationOnce(() => {
      throw new Error('editor rejected');
    });

    await requiredEditorCallback(create)(publicEditor, {} as never);
    await requiredCallback(refresh)();

    expect(notice.mock.calls.map(([message]) => message)).toStrictEqual([
      'Could not create tabs block.',
      'Could not refresh tab contents.',
    ]);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenNthCalledWith(
      1,
      '[tabbed] Could not create tabs block',
      expect.any(Object),
    );
    expect(log).toHaveBeenNthCalledWith(
      2,
      '[tabbed] Could not refresh tab contents',
      expect.any(Object),
    );
  });

  it('reads current settings and suppresses only success Notices', async () => {
    const notice = vi.spyOn(Notice.prototype, 'constructor__');
    const current = settings({ showSuccessNotices: false });
    const host: TabbedCommandHost = {
      getSettings: () => current,
      refreshLiveBlocks: vi.fn(async () => undefined),
    };
    const commands = createTabbedCommands(host);
    const create = commandAt(commands, 0);
    const refresh = commandAt(commands, 1);
    const { publicEditor } = selectedEditor('body');

    await requiredEditorCallback(create)(publicEditor, {} as never);
    await requiredCallback(refresh)();

    expect(notice).not.toHaveBeenCalled();
  });
});
