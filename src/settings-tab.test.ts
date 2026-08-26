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

interface Deferred {
  readonly promise: Promise<void>;
  resolve(): void;
}

function deferred(): Deferred {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: () => {
      resolvePromise?.();
    },
  };
}

class TestBlock implements LiveBlock {
  readonly received: TabbedSettings[] = [];

  applySettings(settings: TabbedSettings): Promise<void> {
    this.received.push(settings);
    return Promise.resolve();
  }
}

class DeferredBlock implements LiveBlock {
  readonly received: TabbedSettings[] = [];
  private readonly gate: Deferred;

  constructor(gate: Deferred) {
    this.gate = gate;
  }

  async applySettings(settings: TabbedSettings): Promise<void> {
    this.received.push(settings);
    await this.gate.promise;
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

function dropdownOptions(tab: TabbedSettingsTab, key: SettingKey): Record<string, string> {
  const control = definition(tab, key).control;
  if (control.type !== 'dropdown') {
    throw new Error(`${key} must be a dropdown control`);
  }
  return control.options;
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

    expect(dropdownOptions(tab, 'action')).toStrictEqual({
      none: 'None',
      add: 'Add tab',
      edit: 'Edit tab',
    });
    expect(dropdownOptions(tab, 'border')).toStrictEqual({
      none: 'None',
      hover: 'On hover',
      always: 'Always',
    });
    expect(dropdownOptions(tab, 'titlePosition')).toStrictEqual({
      top: 'Top',
      bottom: 'Bottom',
      left: 'Left',
      right: 'Right',
    });
    expect(dropdownOptions(tab, 'titleLineMode')).toStrictEqual({
      one: 'Single line',
      multi: 'Multiple lines',
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
  it('does not expose an arbitrary property for an unknown setting key', () => {
    const { host, tab } = createTab();
    Object.assign(host.settings, { obsoleteSetting: 'legacy value' });

    expect(tab.getControlValue('obsoleteSetting')).toBeUndefined();
  });

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

  it('stays pending until persistence and every live update finish', async () => {
    const persistence = deferred();
    const firstGate = deferred();
    const secondGate = deferred();
    const first = new DeferredBlock(firstGate);
    const second = new DeferredBlock(secondGate);
    const { host, tab } = createTab([first, second]);
    const originalUpdate = host.updateSettings.bind(host);
    host.updateSettings = async (next): Promise<void> => {
      await persistence.promise;
      await originalUpdate(next);
    };
    let completed = false;

    const pending = tab.setControlValue('borderColor', '#abc').then(() => {
      completed = true;
    });
    await Promise.resolve();
    expect(completed).toBe(false);
    expect(host.persisted).toStrictEqual([]);
    expect(first.received).toStrictEqual([]);

    persistence.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(completed).toBe(false);
    expect(host.persisted).toStrictEqual([{ ...DEFAULT_SETTINGS, borderColor: '#abc' }]);
    expect(first.received).toStrictEqual([{ ...DEFAULT_SETTINGS, borderColor: '#abc' }]);
    expect(second.received).toStrictEqual([{ ...DEFAULT_SETTINGS, borderColor: '#abc' }]);

    firstGate.resolve();
    await Promise.resolve();
    expect(completed).toBe(false);

    secondGate.resolve();
    await pending;
    expect(completed).toBe(true);
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

  function styleRules(source: string): CSSStyleRule[] {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(source);
    return Array.from(sheet.cssRules).filter(
      (rule): rule is CSSStyleRule => 'selectorText' in rule && 'style' in rule,
    );
  }

  function selectors(rules: readonly CSSStyleRule[]): string[] {
    return rules.flatMap((rule) => rule.selectorText.split(',').map((selector) => selector.trim()));
  }

  function declaration(rules: readonly CSSStyleRule[], element: Element, property: string): string {
    let value = '';
    for (const rule of rules) {
      if (element.matches(rule.selectorText) && rule.style.getPropertyValue(property) !== '') {
        value = rule.style.getPropertyValue(property);
      }
    }
    return value;
  }

  function layout(position: 'top' | 'bottom' | 'left' | 'right', lineMode: 'one' | 'multi') {
    const root = createDiv({ cls: `tabbed tabbed--${position} tabbed--${lineMode}` });
    const list = root.createDiv({ cls: 'tabbed__list' });
    const tab = list.createEl('button', { cls: 'tabbed__tab is-active' });
    const title = tab.createSpan({ cls: 'tabbed__title' });
    const panel = root.createDiv({ cls: 'tabbed__panel' });
    return { root, list, tab, title, panel };
  }

  it.each([
    ['top', 'column', 'row', 'inset 0 calc(-1 * var(--border-width)) 0 var(--interactive-accent)'],
    ['bottom', 'column', 'row', 'inset 0 var(--border-width) 0 var(--interactive-accent)'],
    ['left', 'row', 'column', 'inset calc(-1 * var(--border-width)) 0 0 var(--interactive-accent)'],
    ['right', 'row', 'column', 'inset var(--border-width) 0 0 var(--interactive-accent)'],
  ] as const)(
    'matches the %s layout and puts its active edge beside the panel',
    async (position, rootDirection, listDirection, activeEdge) => {
      const rules = styleRules(await readStyles());
      const { root, list, tab, panel } = layout(position, 'one');

      expect(declaration(rules, root, 'flex-direction')).toBe(rootDirection);
      expect(declaration(rules, list, 'flex-direction')).toBe(listDirection);
      expect(declaration(rules, tab, 'box-shadow')).toBe(activeEdge);
      expect(declaration(rules, panel, 'padding')).toBe('var(--tabbed-content-padding)');
      expect(declaration(rules, panel, 'max-height')).toBe('var(--tabbed-content-max-height)');
    },
  );

  it.each([
    ['one', 'nowrap', 'nowrap'],
    ['multi', 'wrap', 'normal'],
  ] as const)('applies %s-line title flow', async (lineMode, flexWrap, whiteSpace) => {
    const rules = styleRules(await readStyles());
    const { list, title } = layout('top', lineMode);

    expect(declaration(rules, list, 'flex-wrap')).toBe(flexWrap);
    expect(declaration(rules, title, 'white-space')).toBe(whiteSpace);
  });

  it('distinguishes inactive, active, and keyboard-focused tabs', async () => {
    const rules = styleRules(await readStyles());
    const { root, tab } = layout('top', 'one');
    tab.removeClass('is-active');
    expect(declaration(rules, tab, 'color')).toBe('var(--text-muted)');

    tab.addClass('is-active');
    expect(declaration(rules, tab, 'color')).toBe('var(--text-normal)');

    document.body.append(root);
    tab.focus();
    expect(declaration(rules, tab, 'outline')).toBe(
      'var(--border-width) solid var(--background-modifier-border-focus)',
    );
    root.remove();
  });

  it('uses only plugin-scoped focus-visible selectors for keyboard focus', async () => {
    const focusSelectors = selectors(styleRules(await readStyles())).filter((selector) =>
      selector.includes(':focus'),
    );

    expect(focusSelectors.every((selector) => selector.startsWith('.tabbed'))).toBe(true);
    expect(
      focusSelectors.some(
        (selector) => selector.includes(':focus') && !selector.includes(':focus-visible'),
      ),
    ).toBe(false);
    expect(focusSelectors).toStrictEqual([
      ".tabbed > [class~='tabbed__list'] > [class~='tabbed__tab']:focus-visible",
      ".tabbed > [class~='tabbed__list'] > [class~='tabbed__action']:focus-visible",
    ]);
  });

  it('hides only the native edit button belonging to the marked sibling block', async () => {
    const rules = styleRules(await readStyles());
    const container = createDiv();
    container.createDiv({ cls: 'embed-actions' }).createEl('button', {
      cls: 'edit-block-button',
    });
    container.createDiv({ cls: 'block-language-tabs tabbed-host' });
    const ownedActions = container.createDiv({ cls: 'embed-actions' });
    const ownedButton = ownedActions.createDiv().createEl('button', { cls: 'edit-block-button' });
    const unrelatedButton = container.querySelector<HTMLElement>(
      '.embed-actions .edit-block-button',
    );
    if (unrelatedButton === null) {
      throw new Error('Expected unrelated native edit button');
    }

    expect(declaration(rules, ownedButton, 'display')).toBe('none');
    expect(declaration(rules, unrelatedButton, 'display')).toBe('');
  });

  it('sizes only a plugin-owned editor modal', async () => {
    const rules = styleRules(await readStyles());
    const genericModal = createDiv({ cls: 'modal' });
    const editorModal = createDiv({ cls: 'modal tabbed-editor-modal' });
    const content = editorModal.createDiv({
      cls: 'modal-content tabbed-editor-modal__content',
    });
    const title = content.createEl('input', { cls: 'tabbed-editor-modal__title' });
    const toolbar = content.createDiv({ cls: 'tabbed-editor-modal__toolbar' });
    const editor = content.createDiv({ cls: 'cm-editor' });

    expect(declaration(rules, genericModal, 'width')).toBe('');
    expect(declaration(rules, editorModal, '--tabbed-editor-width')).toBe('52rem');
    expect(declaration(rules, editorModal, 'width')).toBe('min(90vw, var(--tabbed-editor-width))');
    expect(declaration(rules, content, 'flex-direction')).toBe('column');
    expect(declaration(rules, title, 'width')).toBe('100%');
    expect(declaration(rules, toolbar, 'flex-wrap')).toBe('wrap');
    expect(declaration(rules, editor, 'max-height')).toBe('70vh');

    const modalSelectors = selectors(rules).filter((selector) =>
      selector.includes('tabbed-editor-modal'),
    );
    expect(
      modalSelectors.some((selector) => selector.includes('tabbed-editor-modal__content')),
    ).toBe(true);
    expect(modalSelectors.some((selector) => selector.includes('tabbed-editor-modal__title'))).toBe(
      true,
    );
    expect(
      modalSelectors.some((selector) => selector.includes('tabbed-editor-modal__toolbar')),
    ).toBe(true);
    expect(
      modalSelectors.some(
        (selector) =>
          selector.includes('.modal-content') ||
          selector.includes('[aria-label') ||
          selector.includes('[role'),
      ),
    ).toBe(false);
  });

  it('keeps all plugin chrome scoped and theme-controlled', async () => {
    const styles = await readStyles();
    const selectorList = selectors(styleRules(styles));
    expect(selectorList.some((selector) => selector.startsWith('body'))).toBe(false);
    expect(selectorList.some((selector) => selector.startsWith('.tabs-'))).toBe(false);
    expect(styles).not.toMatch(/#[\da-f]|\brgb|\bhsl/iu);
    expect(styles).not.toMatch(/\.(?:is-loading|is-error|is-empty|is-success)\b/u);
  });
});
