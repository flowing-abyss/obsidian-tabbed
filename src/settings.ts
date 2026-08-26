export interface TabbedSettings {
  separator: string;
  defaultTitle: string;
  defaultContent: string;
  action: 'none' | 'add' | 'edit';
  showSuccessNotices: boolean;
  dragAndDrop: boolean;
  doubleClickToEdit: boolean;
  showEditorToolbar: boolean;
  tabSize: number;
  autoSaveDelayMs: number;
  border: 'none' | 'hover' | 'always';
  borderColor: string;
  hideNativeEditButton: boolean;
  titlePosition: 'top' | 'bottom' | 'left' | 'right';
  titleLineMode: 'one' | 'multi';
  limitTitleWidth: boolean;
  contentPadding: string;
  contentMaxHeight: string;
}

export const DEFAULT_SETTINGS: TabbedSettings = {
  separator: 'tab: ',
  defaultTitle: 'New tab',
  defaultContent: 'New tab content',
  action: 'add',
  showSuccessNotices: true,
  dragAndDrop: false,
  doubleClickToEdit: false,
  showEditorToolbar: true,
  tabSize: 4,
  autoSaveDelayMs: 5000,
  border: 'hover',
  borderColor: '#e0e0e0',
  hideNativeEditButton: true,
  titlePosition: 'top',
  titleLineMode: 'one',
  limitTitleWidth: false,
  contentPadding: '1em 2em',
  contentMaxHeight: 'none',
};

const cssLength = /^(?:\d+(?:\.\d*)?|\.\d+)(?:px|em|rem|%|vh|vw)$/;
const hexColor = /^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getOwnValue(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor?.value;
}

function valueOrDefault<T>(
  record: Record<string, unknown>,
  key: string,
  defaultValue: T,
  isValid: (value: unknown) => value is T,
): T {
  const value = getOwnValue(record, key);
  return isValid(value) ? value : defaultValue;
}

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.includes(value as T);
}

function isNumberInRange(minimum: number, maximum: number): (value: unknown) => value is number {
  return (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function isSingleLineString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !/[\r\n]/.test(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && hexColor.test(value);
}

function isPadding(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    !/[\r\n]/.test(value) &&
    value.split(' ').length <= 4 &&
    value.split(' ').every((token) => token === '0' || cssLength.test(token))
  );
}

function isMaxHeight(value: unknown): value is string {
  return typeof value === 'string' && (value === 'none' || value === '0' || cssLength.test(value));
}

function isAction(value: unknown): value is TabbedSettings['action'] {
  return isOneOf(value, ['none', 'add', 'edit']);
}

export function normalizeSettings(value: unknown): TabbedSettings {
  const saved = isRecord(value) ? value : {};

  return {
    separator: valueOrDefault(saved, 'separator', DEFAULT_SETTINGS.separator, isSingleLineString),
    defaultTitle: valueOrDefault(saved, 'defaultTitle', DEFAULT_SETTINGS.defaultTitle, isString),
    defaultContent: valueOrDefault(
      saved,
      'defaultContent',
      DEFAULT_SETTINGS.defaultContent,
      isString,
    ),
    action: valueOrDefault(saved, 'action', DEFAULT_SETTINGS.action, isAction),
    showSuccessNotices: valueOrDefault(
      saved,
      'showSuccessNotices',
      DEFAULT_SETTINGS.showSuccessNotices,
      isBoolean,
    ),
    dragAndDrop: valueOrDefault(saved, 'dragAndDrop', DEFAULT_SETTINGS.dragAndDrop, isBoolean),
    doubleClickToEdit: valueOrDefault(
      saved,
      'doubleClickToEdit',
      DEFAULT_SETTINGS.doubleClickToEdit,
      isBoolean,
    ),
    showEditorToolbar: valueOrDefault(
      saved,
      'showEditorToolbar',
      DEFAULT_SETTINGS.showEditorToolbar,
      isBoolean,
    ),
    tabSize: valueOrDefault(saved, 'tabSize', DEFAULT_SETTINGS.tabSize, isNumberInRange(1, 8)),
    autoSaveDelayMs: valueOrDefault(
      saved,
      'autoSaveDelayMs',
      DEFAULT_SETTINGS.autoSaveDelayMs,
      isNumberInRange(0, 60_000),
    ),
    border: valueOrDefault(saved, 'border', DEFAULT_SETTINGS.border, (candidate) =>
      isOneOf(candidate, ['none', 'hover', 'always']),
    ),
    borderColor: valueOrDefault(saved, 'borderColor', DEFAULT_SETTINGS.borderColor, isHexColor),
    hideNativeEditButton: valueOrDefault(
      saved,
      'hideNativeEditButton',
      DEFAULT_SETTINGS.hideNativeEditButton,
      isBoolean,
    ),
    titlePosition: valueOrDefault(
      saved,
      'titlePosition',
      DEFAULT_SETTINGS.titlePosition,
      (candidate) => isOneOf(candidate, ['top', 'bottom', 'left', 'right']),
    ),
    titleLineMode: valueOrDefault(
      saved,
      'titleLineMode',
      DEFAULT_SETTINGS.titleLineMode,
      (candidate) => isOneOf(candidate, ['one', 'multi']),
    ),
    limitTitleWidth: valueOrDefault(
      saved,
      'limitTitleWidth',
      DEFAULT_SETTINGS.limitTitleWidth,
      isBoolean,
    ),
    contentPadding: valueOrDefault(
      saved,
      'contentPadding',
      DEFAULT_SETTINGS.contentPadding,
      isPadding,
    ),
    contentMaxHeight: valueOrDefault(
      saved,
      'contentMaxHeight',
      DEFAULT_SETTINGS.contentMaxHeight,
      isMaxHeight,
    ),
  };
}
