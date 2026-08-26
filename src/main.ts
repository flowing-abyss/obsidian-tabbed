import { Plugin } from 'obsidian';
import { normalizeSettings, type TabbedSettings } from './settings.js';

export default class TabbedPlugin extends Plugin {
  override settings!: TabbedSettings;

  override async onload(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());
  }

  override onunload(): void {}

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
