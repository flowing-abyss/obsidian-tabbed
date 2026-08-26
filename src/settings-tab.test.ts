import { Platform, Plugin, type PluginManifest, type SettingDefinitionControl } from 'obsidian';
import { App } from 'obsidian-test-mocks/obsidian';
import { describe, expect, it } from 'vitest';
import manifest from '../manifest.json';
import { TabbedSettingsTab, type SettingsHost } from './settings-tab.js';
import { DEFAULT_SETTINGS, type TabbedSettings } from './settings.js';

type SettingKey = keyof TabbedSettings;
type Definition = SettingDefinitionControl<SettingKey>;

const testManifest: PluginManifest = manifest;
const expectedNames: Readonly<Record<SettingKey, string>> = {
  separator: 'Tab separator',
  defaultTitle: 'Default title',
  defaultContent: 'Default content',
  action: 'Tab action',
  showSuccessNotices: 'Show success notices',
  dragAndDrop: 'Enable drag and drop',
  doubleClickToEdit: 'Double-click to edit',
  showEditorToolbar: 'Show editor toolbar',
  tabSize: 'Tab size',
  autoSaveDelayMs: 'Autosave delay (ms)',
  border: 'Border',
  borderColor: 'Border color',
  hideNativeEditButton: 'Hide native edit button',
  titlePosition: 'Title position',
  titleLineMode: 'Title line mode',
  limitTitleWidth: 'Limit title width',
  contentPadding: 'Content padding',
  contentMaxHeight: 'Content maximum height',
};

interface LiveBlock {
  applySettings(settings: TabbedSettings): Promise<void>;
}

class TestBlock implements LiveBlock {
  readonly received: TabbedSettings[] = [];

  applySettings(settings: TabbedSettings): Promise<void> {
    this.received.push(settings);
    return Promise.resolve();
  }
}

class TestHost extends Plugin implements SettingsHost {
  override settings = { ...DEFAULT_SETTINGS };
  readonly persisted: TabbedSettings[] = [];
  private readonly blocks: readonly LiveBlock[];

  constructor(app: App, blocks: readonly LiveBlock[] = []) {
    super(app.asOriginalType__(), testManifest);
    this.blocks = blocks;
  }

  async updateSettings(next: TabbedSettings): Promise<void> {
    this.settings = next;
    this.persisted.push(next);
    await Promise.all(this.blocks.map(async (block) => block.applySettings(next)));
  }
}

function createTab(blocks: readonly LiveBlock[] = []): {
  host: TestHost;
  tab: TabbedSettingsTab;
} {
  const app = App.createConfigured__();
  const host = new TestHost(app, blocks);
  return { host, tab: new TabbedSettingsTab(app.asOriginalType__(), host) };
}

function definitions(tab: TabbedSettingsTab): Definition[] {
  return tab.getSettingDefinitions().filter((item): item is Definition => 'control' in item);
}

function definition(tab: TabbedSettingsTab, key: SettingKey): Definition {
  const found = definitions(tab).find((item) => item.control.key === key);
  if (found === undefined) {
    throw new Error(`Missing definition for ${key}`);
  }
  return found;
}

describe('TabbedSettingsTab definitions', () => {
  it('defines every settings key exactly once with sentence-case labels', () => {
    const { tab } = createTab();
    const items = tab.getSettingDefinitions();
    const controls = definitions(tab);
    const keys = controls.map((item) => item.control.key);

    expect([...keys].sort((left, right) => left.localeCompare(right))).toStrictEqual(
      Object.keys(DEFAULT_SETTINGS).sort((left, right) => left.localeCompare(right)),
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect(Object.fromEntries(controls.map((item) => [item.control.key, item.name]))).toStrictEqual(
      expectedNames,
    );
    expect(items.every((item) => !('heading' in item) && !('render' in item))).toBe(true);
    const prototype = Reflect.getPrototypeOf(tab);
    expect(
      prototype === null ? false : Object.prototype.hasOwnProperty.call(prototype, 'display'),
    ).toBe(false);
  });

  it('offers only the supported values for every enum setting', () => {
    const { tab } = createTab();

    expect(definition(tab, 'action').control).toMatchObject({
      type: 'dropdown',
      options: { none: 'None', add: 'Add tab', edit: 'Edit tab' },
    });
    expect(definition(tab, 'border').control).toMatchObject({
      type: 'dropdown',
      options: { none: 'None', hover: 'On hover', always: 'Always' },
    });
    expect(definition(tab, 'titlePosition').control).toMatchObject({
      type: 'dropdown',
      options: { top: 'Top', bottom: 'Bottom', left: 'Left', right: 'Right' },
    });
    expect(definition(tab, 'titleLineMode').control).toMatchObject({
      type: 'dropdown',
      options: { one: 'Single line', multi: 'Multiple lines' },
    });
  });

  it('matches numeric normalization bounds', () => {
    const { tab } = createTab();

    expect(definition(tab, 'tabSize').control).toMatchObject({
      type: 'number',
      min: 1,
      max: 8,
    });
    expect(definition(tab, 'autoSaveDelayMs').control).toMatchObject({
      type: 'number',
      min: 0,
      max: 60_000,
    });
  });

  it.each([
    ['', 'Enter a non-empty, single-line separator.'],
    ['tab:\n', 'Enter a non-empty, single-line separator.'],
    ['tab:\rnext', 'Enter a non-empty, single-line separator.'],
    [':: ', undefined],
  ])('validates separator %j', async (value, expected) => {
    const { tab } = createTab();
    const control = definition(tab, 'separator').control;
    if (control.type !== 'text' || control.validate === undefined) {
      throw new Error('Separator must be a validated text control');
    }

    expect(await control.validate(value)).toBe(expected);
  });
});

describe('TabbedSettingsTab updates', () => {
  it.each([
    ['separator', ':: '],
    ['borderColor', '#abc'],
    ['dragAndDrop', true],
  ] as const)('normalizes and delivers a %s change to every live block', async (key, value) => {
    const first = new TestBlock();
    const second = new TestBlock();
    const { host, tab } = createTab([first, second]);

    await tab.setControlValue(key, value);

    expect(host.settings).toStrictEqual({ ...DEFAULT_SETTINGS, [key]: value });
    expect(host.persisted).toStrictEqual([host.settings]);
    expect(first.received).toStrictEqual([host.settings]);
    expect(second.received).toStrictEqual([host.settings]);
    expect(tab.getControlValue(key)).toBe(value);
  });

  it('normalizes rejected values before the host persists them', async () => {
    const { host, tab } = createTab();

    await tab.setControlValue('tabSize', 99);

    expect(host.persisted).toStrictEqual([{ ...DEFAULT_SETTINGS }]);
  });
});

describe('styles', () => {
  async function readStyles(): Promise<string> {
    if (!Platform.isDesktop) {
      throw new Error('Style source contracts run only in the desktop Node test process');
    }
    const { readFile } = await import('node:fs/promises');
    return readFile('styles.css', 'utf8');
  }

  function selectorHeads(source: string): string[] {
    return source
      .split('{')
      .slice(0, -1)
      .flatMap((chunk) => chunk.slice(chunk.lastIndexOf('}') + 1).split(','))
      .map((selector) => selector.trim());
  }

  it('covers horizontal, vertical, one-line, multi-line, and editor-modal layouts', async () => {
    const styles = await readStyles();
    expect(styles).toContain('.tabbed');
    expect(styles).toContain(".tabbed[class~='tabbed--top']");
    expect(styles).toContain(".tabbed[class~='tabbed--bottom']");
    expect(styles).toContain(".tabbed[class~='tabbed--left']");
    expect(styles).toContain(".tabbed[class~='tabbed--right']");
    expect(styles).toContain(".tabbed[class~='tabbed--one']");
    expect(styles).toContain(".tabbed[class~='tabbed--multi']");
    expect(styles).toContain('--tabbed-content-padding');
    expect(styles).toContain('--tabbed-content-max-height');
    expect(styles).toContain(':focus-visible');
    expect(styles).toContain('.modal:has(');
  });

  it('keeps all plugin chrome scoped and theme-controlled', async () => {
    const styles = await readStyles();
    const selectors = selectorHeads(styles);
    expect(selectors.some((selector) => selector.startsWith('body'))).toBe(false);
    expect(selectors.some((selector) => selector.startsWith('.tabs-'))).toBe(false);
    expect(styles).not.toMatch(/#[\da-f]|\brgb|\bhsl/iu);
    expect(styles).toContain('.tabbed-host > .edit-block-button');
    for (const rule of styles.split('}').filter((value) => value.includes('.edit-block-button'))) {
      expect(rule.trimStart().startsWith('.tabbed-host > .edit-block-button')).toBe(true);
    }
    expect(styles).not.toMatch(/\.(?:is-loading|is-error|is-empty|is-success)\b/u);
  });
});
