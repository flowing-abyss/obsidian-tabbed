import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings } from './settings.js';

describe('normalizeSettings', () => {
  it('returns the documented defaults for an unrecognized saved value', () => {
    expect(normalizeSettings(null)).toStrictEqual({
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
    });
  });

  it('accepts valid stored values without changing other defaults', () => {
    expect(
      normalizeSettings({
        separator: '::',
        defaultTitle: 'Tab',
        defaultContent: 'Content',
        action: 'edit',
        showSuccessNotices: false,
        dragAndDrop: true,
        doubleClickToEdit: true,
        showEditorToolbar: false,
        tabSize: 8,
        autoSaveDelayMs: 0,
        border: 'always',
        borderColor: '#A1b2C3',
        hideNativeEditButton: false,
        titlePosition: 'left',
        titleLineMode: 'multi',
        limitTitleWidth: true,
        contentPadding: '0 1.5rem 20% 4vw',
        contentMaxHeight: '100vh',
      }),
    ).toMatchObject({
      separator: '::',
      defaultTitle: 'Tab',
      defaultContent: 'Content',
      action: 'edit',
      showSuccessNotices: false,
      dragAndDrop: true,
      doubleClickToEdit: true,
      showEditorToolbar: false,
      tabSize: 8,
      autoSaveDelayMs: 0,
      border: 'always',
      borderColor: '#A1b2C3',
      hideNativeEditButton: false,
      titlePosition: 'left',
      titleLineMode: 'multi',
      limitTitleWidth: true,
      contentPadding: '0 1.5rem 20% 4vw',
      contentMaxHeight: '100vh',
    });
  });

  it('falls back for invalid values instead of coercing them', () => {
    expect(
      normalizeSettings({
        separator: 'two\nlines',
        action: 'remove',
        showSuccessNotices: 'true',
        tabSize: 99,
        autoSaveDelayMs: -1,
        border: 'visible',
        borderColor: 'red',
        titlePosition: 'invalid',
        titleLineMode: 'single',
      }),
    ).toMatchObject({
      separator: DEFAULT_SETTINGS.separator,
      action: DEFAULT_SETTINGS.action,
      showSuccessNotices: DEFAULT_SETTINGS.showSuccessNotices,
      tabSize: DEFAULT_SETTINGS.tabSize,
      autoSaveDelayMs: DEFAULT_SETTINGS.autoSaveDelayMs,
      border: DEFAULT_SETTINGS.border,
      borderColor: DEFAULT_SETTINGS.borderColor,
      titlePosition: 'top',
      titleLineMode: DEFAULT_SETTINGS.titleLineMode,
    });
  });

  it('ignores inherited settings fields', () => {
    const inherited = Object.create({ titlePosition: 'bottom' }) as object;

    expect(normalizeSettings(inherited).titlePosition).toBe('top');
  });

  it.each(['0', '12px', '1em 2rem', '5% 3vh 2vw 0'])(
    'accepts valid content padding %s',
    (contentPadding) => {
      expect(normalizeSettings({ contentPadding }).contentPadding).toBe(contentPadding);
    },
  );

  it.each([
    '',
    '-1px',
    'calc(1px)',
    '1px; color: red',
    '1px 2px 3px 4px 5px',
    '1px\n2px',
    () => '1px',
  ])('rejects invalid content padding %s', (contentPadding) => {
    expect(normalizeSettings({ contentPadding }).contentPadding).toBe(
      DEFAULT_SETTINGS.contentPadding,
    );
  });

  it.each(['none', '0', '600px', '75vh'])(
    'accepts valid content max height %s',
    (contentMaxHeight) => {
      expect(normalizeSettings({ contentMaxHeight }).contentMaxHeight).toBe(contentMaxHeight);
    },
  );

  it.each(['auto', '-1rem', '100px 20px', '1px; color: red', () => '1px'])(
    'rejects invalid content max height %s',
    (contentMaxHeight) => {
      expect(normalizeSettings({ contentMaxHeight }).contentMaxHeight).toBe(
        DEFAULT_SETTINGS.contentMaxHeight,
      );
    },
  );
});
