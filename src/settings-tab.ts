import { PluginSettingTab, type App, type Plugin, type SettingDefinitionItem } from 'obsidian';
import { DEFAULT_SETTINGS, normalizeSettings, type TabbedSettings } from './settings.js';

export interface SettingsHost {
  settings: TabbedSettings;
  updateSettings(next: TabbedSettings): void | Promise<void>;
}

type SettingKey = keyof TabbedSettings;

const settingKeys = new Set<string>(Object.keys(DEFAULT_SETTINGS));

function isSettingKey(key: string): key is SettingKey {
  return settingKeys.has(key);
}

function validateSeparator(value: string): string | undefined {
  return value.length === 0 || /[\r\n]/u.test(value)
    ? 'Enter a non-empty, single-line separator.'
    : undefined;
}

const settingDefinitions: Array<SettingDefinitionItem<SettingKey>> = [
  {
    name: 'Tab separator',
    desc: 'Text at the start of a line that begins a tab.',
    control: {
      type: 'text',
      key: 'separator',
      defaultValue: DEFAULT_SETTINGS.separator,
      validate: validateSeparator,
    },
  },
  {
    name: 'Default title',
    desc: 'Title used when a tab has no title.',
    control: {
      type: 'text',
      key: 'defaultTitle',
      defaultValue: DEFAULT_SETTINGS.defaultTitle,
    },
  },
  {
    name: 'Default content',
    desc: 'Content inserted when a new tab is empty.',
    control: {
      type: 'textarea',
      key: 'defaultContent',
      defaultValue: DEFAULT_SETTINGS.defaultContent,
      rows: 3,
    },
  },
  {
    name: 'Tab action',
    desc: 'Action shown after the tab titles.',
    control: {
      type: 'dropdown',
      key: 'action',
      defaultValue: DEFAULT_SETTINGS.action,
      options: { none: 'None', add: 'Add tab', edit: 'Edit tab' },
    },
  },
  {
    name: 'Show success notices',
    desc: 'Show a notice after a tab action succeeds.',
    control: { type: 'toggle', key: 'showSuccessNotices' },
  },
  {
    name: 'Enable drag and drop',
    desc: 'Allow tabs to be reordered in source mode on desktop.',
    control: { type: 'toggle', key: 'dragAndDrop' },
  },
  {
    name: 'Double-click to edit',
    desc: 'Open the active tab editor by double-clicking its content.',
    control: { type: 'toggle', key: 'doubleClickToEdit' },
  },
  {
    name: 'Show editor toolbar',
    desc: 'Show formatting actions in the tab editor.',
    control: { type: 'toggle', key: 'showEditorToolbar' },
  },
  {
    name: 'Tab size',
    desc: 'Spaces inserted by indentation actions.',
    control: { type: 'number', key: 'tabSize', min: 1, max: 8 },
  },
  {
    name: 'Autosave delay (ms)',
    desc: 'Delay before tab editor changes are saved.',
    control: { type: 'number', key: 'autoSaveDelayMs', min: 0, max: 60_000 },
  },
  {
    name: 'Border',
    desc: 'When to show the border around a tab block.',
    control: {
      type: 'dropdown',
      key: 'border',
      defaultValue: DEFAULT_SETTINGS.border,
      options: { none: 'None', hover: 'On hover', always: 'Always' },
    },
  },
  {
    name: 'Border color',
    desc: 'Color used for the tab block border.',
    control: { type: 'color', key: 'borderColor' },
  },
  {
    name: 'Hide native edit button',
    desc: "Hide Obsidian's code block edit button for tab blocks.",
    control: { type: 'toggle', key: 'hideNativeEditButton' },
  },
  {
    name: 'Title position',
    desc: 'Place tab titles on one side of the content.',
    control: {
      type: 'dropdown',
      key: 'titlePosition',
      defaultValue: DEFAULT_SETTINGS.titlePosition,
      options: { top: 'Top', bottom: 'Bottom', left: 'Left', right: 'Right' },
    },
  },
  {
    name: 'Title line mode',
    desc: 'Keep titles on one line or allow them to wrap.',
    control: {
      type: 'dropdown',
      key: 'titleLineMode',
      defaultValue: DEFAULT_SETTINGS.titleLineMode,
      options: { one: 'Single line', multi: 'Multiple lines' },
    },
  },
  {
    name: 'Limit title width',
    desc: 'Keep long titles from taking all available space.',
    control: { type: 'toggle', key: 'limitTitleWidth' },
  },
  {
    name: 'Content padding',
    desc: 'CSS padding applied inside the active tab panel.',
    control: {
      type: 'text',
      key: 'contentPadding',
      defaultValue: DEFAULT_SETTINGS.contentPadding,
    },
  },
  {
    name: 'Content maximum height',
    desc: 'Maximum panel height as a CSS length, or none.',
    control: {
      type: 'text',
      key: 'contentMaxHeight',
      defaultValue: DEFAULT_SETTINGS.contentMaxHeight,
    },
  },
];

export class TabbedSettingsTab extends PluginSettingTab {
  private readonly host: SettingsHost;

  constructor(app: App, host: Plugin & SettingsHost) {
    super(app, host);
    this.host = host;
  }

  override getSettingDefinitions(): Array<SettingDefinitionItem<SettingKey>> {
    return settingDefinitions;
  }

  override getControlValue(key: string): unknown {
    return isSettingKey(key) ? this.host.settings[key] : undefined;
  }

  override async setControlValue(key: string, value: unknown): Promise<void> {
    const candidate = isSettingKey(key)
      ? { ...this.host.settings, [key]: value }
      : this.host.settings;
    await this.host.updateSettings(normalizeSettings(candidate));
  }
}
