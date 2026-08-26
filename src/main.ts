import { Plugin } from 'obsidian';
import { formatError } from './diagnostics.js';
import { TabEditorModal } from './editor/tab-editor-modal.js';
import { createTabbedCommands } from './interactions/commands.js';
import { DragController } from './interactions/drag-controller.js';
import { addDefaultTab, showTabMenu } from './interactions/tab-menu.js';
import { TabsBlock, type TabsBlockHost } from './render/tabs-block.js';
import { TabbedSettingsTab } from './settings-tab.js';
import { normalizeSettings, type TabbedSettings } from './settings.js';
import { SelectionMemory } from './tabs/selection-memory.js';

export default class TabbedPlugin extends Plugin {
  override settings!: TabbedSettings;
  private readonly liveBlocks = new Set<TabsBlock>();
  private readonly selectionMemory = new SelectionMemory(256);
  private dragController: DragController | null = null;
  private editorModal: TabEditorModal | null = null;
  private readonly blockHost: TabsBlockHost = {
    register: (block) => {
      this.liveBlocks.add(block);
      this.dragController?.bind(block);
    },
    unregister: (block) => {
      this.dragController?.unbind(block);
      this.liveBlocks.delete(block);
    },
    addTab: (block) => {
      addDefaultTab(block, () => this.settings);
    },
    editTab: (block, index) => {
      this.openTabEditor(block, index);
    },
    openTabMenu: (block, index, event) => {
      showTabMenu({ block, index, event, getSettings: () => this.settings });
    },
  };

  override async onload(): Promise<void> {
    try {
      this.settings = normalizeSettings(await this.loadData());
    } catch (error) {
      throw new Error(`Could not load Tabbed settings: ${formatError(error)}`);
    }

    this.dragController = this.addChild(new DragController(() => this.settings));
    this.registerMarkdownCodeBlockProcessor('tabs', (source, element, context) => {
      context.addChild(
        new TabsBlock(
          this.app,
          element,
          source,
          context,
          this.settings,
          this.selectionMemory,
          this.blockHost,
        ),
      );
    });
    for (const command of createTabbedCommands({
      getSettings: () => this.settings,
      refreshLiveBlocks: () => this.refreshLiveBlocks(),
    })) {
      this.addCommand(command);
    }
    this.addSettingTab(new TabbedSettingsTab(this.app, this));
  }

  override onunload(): void {
    this.editorModal?.dispose();
    this.editorModal = null;
    this.dragController?.clear();
    this.dragController = null;
    this.selectionMemory.clear();
    this.liveBlocks.clear();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async updateSettings(next: TabbedSettings): Promise<void> {
    const blocks = [...this.liveBlocks];
    this.settings = normalizeSettings(next);
    await this.saveSettings();
    await Promise.all(
      blocks.map(async (block) => {
        await block.applySettings(this.settings);
        if (this.liveBlocks.has(block)) {
          this.dragController?.bind(block);
        }
      }),
    );
  }

  async refreshLiveBlocks(): Promise<void> {
    await Promise.all([...this.liveBlocks].map((block) => block.refreshActiveBody()));
  }

  private openTabEditor(block: TabsBlock, index: number): void {
    const locator = block.locator;
    const tab = block.document.tabs[index];
    if (locator === null || tab === undefined) {
      return;
    }
    this.getEditorModal().openFor({
      locator,
      index,
      title: tab.title,
      content: tab.content,
      sourcePath: block.sourcePath,
    });
  }

  private getEditorModal(): TabEditorModal {
    this.editorModal ??= new TabEditorModal(this.app, () => this.settings);
    return this.editorModal;
  }
}
