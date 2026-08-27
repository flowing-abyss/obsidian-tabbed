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
  private editorBlock: TabsBlock | null = null;
  private settingsUpdateTail: Promise<void> = Promise.resolve();
  private settingsUpdateRevision = 0;
  private lifecycleGeneration = 0;
  private disposed = true;
  private readonly blockHost: TabsBlockHost = {
    register: (block) => {
      this.liveBlocks.add(block);
      this.dragController?.bind(block);
    },
    unregister: (block) => {
      if (this.editorBlock === block) {
        this.editorModal?.dispose();
        this.editorModal = null;
        this.editorBlock = null;
      }
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
    this.disposed = false;
    this.lifecycleGeneration += 1;
    try {
      this.settings = normalizeSettings(await this.loadData());
    } catch (error) {
      this.disposed = true;
      this.lifecycleGeneration += 1;
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
    this.disposed = true;
    this.lifecycleGeneration += 1;
    this.settingsUpdateRevision += 1;
    this.editorModal?.dispose();
    this.editorModal = null;
    this.editorBlock = null;
    this.dragController?.clear();
    this.dragController = null;
    this.selectionMemory.clear();
    this.liveBlocks.clear();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async updateSettings(next: TabbedSettings): Promise<void> {
    const settings = normalizeSettings(next);
    const revision = ++this.settingsUpdateRevision;
    const generation = this.lifecycleGeneration;
    this.settings = settings;

    const update = this.settingsUpdateTail.then(async () => {
      if (!this.isCurrentSettingsUpdate(revision, generation)) {
        return;
      }
      await this.saveData(settings);
      if (!this.isCurrentSettingsUpdate(revision, generation)) {
        return;
      }
      const blocks = [...this.liveBlocks];
      await Promise.all(
        blocks.map(async (block) => {
          if (!this.isCurrentSettingsUpdate(revision, generation) || !this.liveBlocks.has(block)) {
            return;
          }
          await block.applySettings(settings);
          if (this.isCurrentSettingsUpdate(revision, generation) && this.liveBlocks.has(block)) {
            this.dragController?.bind(block);
          }
        }),
      );
    });
    this.settingsUpdateTail = update.then(
      () => undefined,
      () => undefined,
    );
    await update;
  }

  async refreshLiveBlocks(): Promise<void> {
    await Promise.all([...this.liveBlocks].map((block) => block.refreshActiveBody()));
  }

  private openTabEditor(block: TabsBlock, index: number): void {
    const authority = block.captureMutationAuthority();
    const tab = block.document.tabs[index];
    if (authority === null || tab === undefined) {
      return;
    }
    this.editorBlock = block;
    this.getEditorModal().openFor({
      authority,
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

  private isCurrentSettingsUpdate(revision: number, generation: number): boolean {
    return (
      !this.disposed &&
      generation === this.lifecycleGeneration &&
      revision === this.settingsUpdateRevision
    );
  }
}
