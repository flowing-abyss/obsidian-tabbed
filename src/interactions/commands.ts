import { Notice, type Command } from 'obsidian';
import { formatError, logError } from '../diagnostics.js';
import type { TabbedSettings } from '../settings.js';

export interface TabbedCommandHost {
  readonly getSettings: () => TabbedSettings;
  readonly refreshLiveBlocks: () => Promise<void>;
}

function longestBacktickRun(value: string): number {
  let longest = 0;
  let current = 0;
  for (const character of value) {
    if (character === '`') {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

export function wrapSelectionAsTabs(selection: string, settings: TabbedSettings): string {
  const lineEnding = selection.includes('\r\n') ? '\r\n' : '\n';
  let inner = selection;
  if (!selection.startsWith(settings.separator)) {
    const content = selection.length === 0 ? settings.defaultContent : selection;
    inner = `${settings.separator}${settings.defaultTitle}${lineEnding}${content}`;
  }
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(inner) + 1));
  const closingLineEnding = inner.endsWith('\n') ? '' : lineEnding;
  return `${fence}tabs${lineEnding}${inner}${closingLineEnding}${fence}`;
}

export function createTabbedCommands(host: TabbedCommandHost): readonly Command[] {
  return [
    {
      id: 'create-tabs-block',
      name: 'Create tabs block',
      editorCallback: (editor) => {
        try {
          const settings = host.getSettings();
          editor.replaceSelection(wrapSelectionAsTabs(editor.getSelection(), settings));
          if (settings.showSuccessNotices) {
            new Notice('Created tabs block.');
          }
        } catch (error) {
          new Notice('Could not create tabs block.');
          logError('Could not create tabs block', { cause: formatError(error) });
        }
      },
    },
    {
      id: 'refresh-tab-contents',
      name: 'Refresh tab contents',
      callback: async () => {
        try {
          await host.refreshLiveBlocks();
          if (host.getSettings().showSuccessNotices) {
            new Notice('Refreshed tab contents.');
          }
        } catch (error) {
          new Notice('Could not refresh tab contents.');
          logError('Could not refresh tab contents', { cause: formatError(error) });
        }
      },
    },
  ];
}
