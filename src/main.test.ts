import type { PluginManifest } from 'obsidian';
import { App } from 'obsidian-test-mocks/obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import manifest from '../manifest.json';
import TabbedPlugin from './main.js';
import { DEFAULT_SETTINGS } from './settings.js';

const testManifest: PluginManifest = manifest;

function createPlugin(): TabbedPlugin {
  const app = App.createConfigured__();
  return new TabbedPlugin(app.asOriginalType__(), testManifest);
}

describe('TabbedPlugin', () => {
  let plugin: TabbedPlugin;

  beforeEach(() => {
    plugin = createPlugin();
  });

  it('declares its Community Store identity', () => {
    expect(manifest).toMatchObject({
      id: 'tabbed',
      name: 'Tabbed',
      version: '0.1.0',
      minAppVersion: '1.13.1',
      author: 'flowing-abyss',
      authorUrl: 'https://github.com/flowing-abyss',
      fundingUrl: 'https://boosty.to/flowing-abyss/donate',
      description: 'Create lazy-loading tabs in your notes.',
      isDesktopOnly: false,
    });
  });

  it('falls back to defaults when nothing was saved', async () => {
    await plugin.onload();

    expect(plugin.settings).toStrictEqual(DEFAULT_SETTINGS);
  });

  it('normalizes invalid saved values on load', async () => {
    vi.spyOn(plugin, 'loadData').mockResolvedValue({ titlePosition: 'invalid', tabSize: 99 });

    await plugin.onload();

    expect(plugin.settings).toMatchObject({
      titlePosition: 'top',
      tabSize: DEFAULT_SETTINGS.tabSize,
    });
  });

  it('persists the current settings via saveSettings', async () => {
    const saveData = vi.spyOn(plugin, 'saveData').mockResolvedValue();
    await plugin.onload();

    await plugin.saveSettings();

    expect(saveData).toHaveBeenCalledWith(plugin.settings);
  });

  it('does not throw on unload', async () => {
    await plugin.onload();

    expect(() => {
      plugin.onunload();
    }).not.toThrow();
  });
});
