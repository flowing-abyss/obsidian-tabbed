import {
  Component,
  MarkdownRenderChild,
  setIcon,
  type App,
  type MarkdownPostProcessorContext,
  type MarkdownSectionInformation,
} from 'obsidian';
import { formatError, logError } from '../diagnostics.js';
import type { TabbedSettings } from '../settings.js';
import type { SourceMutationAuthority } from '../source/mutation-authority.js';
import { SourceLocator } from '../source/source-locator.js';
import type { SelectionMemory } from '../tabs/selection-memory.js';
import type { ParsedTabsDocument } from '../tabs/tab-model.js';
import { literalTabsDocument, parseTabsSource } from '../tabs/tab-parser.js';
import { findOwningMarkdownView } from './find-owning-view.js';
import { TabBody, renderMarkdown, type RenderMarkdown } from './tab-body.js';

export interface TabsBlockHost {
  register(block: TabsBlock): void;
  unregister(block: TabsBlock): void;
  addTab(block: TabsBlock): void;
  editTab(block: TabsBlock, index: number): void;
  openTabMenu(block: TabsBlock, index: number, event: MouseEvent): void;
}

const positionClasses = ['tabbed--top', 'tabbed--bottom', 'tabbed--left', 'tabbed--right'] as const;
const lineClasses = ['tabbed--one', 'tabbed--multi'] as const;
const borderClasses = [
  'tabbed--border-none',
  'tabbed--border-hover',
  'tabbed--border-always',
] as const;

let nextInstanceId = 0;

export class TabsBlock extends MarkdownRenderChild {
  readonly sourcePath: string;
  private readonly app: App;
  private readonly source: string;
  private readonly context: MarkdownPostProcessorContext;
  private readonly renderer: RenderMarkdown;
  private readonly parser: (source: string, settings: TabbedSettings) => ParsedTabsDocument;
  private readonly rootEl: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly hostWrapperEl: HTMLElement | null;
  private readonly selectionMemory: SelectionMemory;
  private readonly host: TabsBlockHost;
  private readonly instanceId = ++nextInstanceId;
  private parsedDocument: ParsedTabsDocument;
  private settings: TabbedSettings;
  private selection = 0;
  private selectionKey: string | null = null;
  private sectionLine: number | null = null;
  private locatorValue: SourceLocator | null = null;
  private tabs: HTMLElement[] = [];
  private titleChildren: Component[] = [];
  private body: TabBody | null = null;
  private mutationInteractions: Component | null = null;
  private generation = 0;
  private locatorGeneration = 0;
  private parserFailed = false;

  constructor(
    ...[
      app,
      containerEl,
      source,
      context,
      settings,
      selectionMemory,
      host,
      renderer = renderMarkdown,
      parser = parseTabsSource,
    ]: [
      App,
      HTMLElement,
      string,
      MarkdownPostProcessorContext,
      TabbedSettings,
      SelectionMemory,
      TabsBlockHost,
      RenderMarkdown?,
      ((source: string, settings: TabbedSettings) => ParsedTabsDocument)?,
    ]
  ) {
    super(containerEl);
    this.app = app;
    this.source = source;
    this.context = context;
    this.sourcePath = context.sourcePath;
    this.renderer = renderer;
    this.parser = parser;
    this.selectionMemory = selectionMemory;
    this.host = host;
    this.settings = { ...settings };
    this.parsedDocument = this.parseDocument(settings);
    this.rootEl = containerEl.createDiv({ cls: 'tabbed' });
    this.listEl = this.rootEl.createDiv({ cls: 'tabbed__list', attr: { role: 'tablist' } });
    this.hostWrapperEl =
      containerEl.closest<HTMLElement>('.block-language-tabs') ?? containerEl.parentElement;
  }

  get document(): ParsedTabsDocument {
    return this.parsedDocument;
  }

  get selectedIndex(): number {
    return this.selection;
  }

  get locator(): SourceLocator | null {
    return this.locatorValue;
  }

  get tabElements(): readonly HTMLElement[] {
    return this.tabs;
  }

  captureMutationAuthority(): SourceMutationAuthority | null {
    const locator = this.locatorValue;
    if (locator === null) {
      return null;
    }
    const generation = this.locatorGeneration;
    const authority: SourceMutationAuthority = {
      locator,
      isActive: () =>
        generation === this.locatorGeneration &&
        this.locatorValue === locator &&
        this.ownsSourceLocator(locator),
    };
    return authority.isActive() ? authority : null;
  }

  override onload(): void {
    const section = this.context.getSectionInfo(this.containerEl);
    this.initializeSection(section);
    this.locatorValue = this.parserFailed ? null : this.createLocator(section, this.settings);
    this.restoreSelection();
    this.registerInteractions();
    this.reconcileMutationInteractions();
    this.updateHostMarker();
    this.host.register(this);
    this.renderTitlesAndAction();
    this.applyShell();
    this.startActivation(this.selection);
  }

  override onunload(): void {
    this.generation += 1;
    this.locatorGeneration += 1;
    this.locatorValue = null;
    this.body?.panelEl.remove();
    this.body = null;
    this.mutationInteractions = null;
    this.titleChildren = [];
    this.tabs = [];
    this.hostWrapperEl?.removeClass('tabbed-host');
    this.rootEl.remove();
    this.host.unregister(this);
  }

  async activate(index: number): Promise<void> {
    const selected = this.clampIndex(index);
    const generation = ++this.generation;
    this.selection = selected;
    this.rememberSelection();

    if (this.body !== null) {
      const oldBody = this.body;
      this.body = null;
      oldBody.panelEl.remove();
      this.removeChild(oldBody);
    }

    const tab = this.parsedDocument.tabs[selected];
    if (tab === undefined) {
      return;
    }

    const panel = createDiv({
      cls: 'tabbed__panel',
      attr: {
        id: `tabbed-${this.instanceId}-panel-${generation}`,
        role: 'tabpanel',
      },
    });
    this.rootEl.append(panel);
    const body = this.addChild(
      new TabBody(this.app, panel, tab.content, this.sourcePath, this.renderer),
    );
    this.body = body;
    this.updateTabState(panel);
    this.applyShell();

    try {
      await body.render();
    } catch (error) {
      if (generation === this.generation && this.body === body) {
        panel.empty();
        logError('Could not render tab body', this.errorContext(selected, error));
      }
    }
    if (generation === this.generation && this.body === body) {
      this.reconcileLocatorAfterRender();
    }
  }

  refreshActiveBody(): Promise<void> {
    return this.activate(this.selection);
  }

  async applySettings(settings: TabbedSettings): Promise<void> {
    const syntaxChanged = this.syntaxSettingsChanged(settings);
    this.settings = { ...settings };
    this.updateHostMarker();

    if (!syntaxChanged) {
      this.applyShell();
      return;
    }

    this.parsedDocument = this.parseDocument(settings);
    this.locatorGeneration += 1;
    this.locatorValue = this.parserFailed
      ? null
      : this.createLocator(this.context.getSectionInfo(this.containerEl), settings);
    this.reconcileMutationInteractions();
    this.selection = this.clampIndex(this.selection);
    this.disposeTitles();
    this.renderTitlesAndAction();
    this.applyShell();
    await this.activate(this.selection);
  }

  private initializeSection(section: MarkdownSectionInformation | null): void {
    if (section === null) {
      return;
    }
    this.sectionLine = section.lineStart;
    this.selectionKey = `${this.sourcePath}:${section.lineStart}`;
  }

  private parseDocument(settings: TabbedSettings): ParsedTabsDocument {
    try {
      const document = this.parser(this.source, settings);
      this.parserFailed = false;
      return document;
    } catch (error) {
      this.parserFailed = true;
      const section = this.context.getSectionInfo(this.containerEl);
      logError('Could not parse tabs block', {
        path: this.sourcePath,
        ...(section === null
          ? {}
          : { section: { lineStart: section.lineStart, lineEnd: section.lineEnd } }),
        cause: formatError(error),
      });
      return literalTabsDocument(this.source, settings);
    }
  }

  private createLocator(
    section: MarkdownSectionInformation | null,
    settings: TabbedSettings,
  ): SourceLocator | null {
    if (section === null) {
      return null;
    }
    const view = findOwningMarkdownView(this.app, this.containerEl);
    if (view?.getMode() !== 'source') {
      return null;
    }
    return SourceLocator.fromSection(view.editor, section, settings);
  }

  private ownsSourceLocator(locator: SourceLocator): boolean {
    const view = findOwningMarkdownView(this.app, this.containerEl);
    return view?.getMode() === 'source' && view.editor === locator.editor;
  }

  private reconcileLocatorAfterRender(): void {
    if (this.parserFailed || this.locatorValue !== null) {
      return;
    }
    const section = this.context.getSectionInfo(this.containerEl);
    const locator = this.createLocator(section, this.settings);
    if (locator === null) {
      return;
    }
    this.initializeSection(section);
    this.locatorGeneration += 1;
    this.locatorValue = locator;
    this.reconcileMutationInteractions();
    this.renderAction();
    this.host.register(this);
  }

  private restoreSelection(): void {
    if (this.selectionKey === null) {
      return;
    }
    const remembered = this.selectionMemory.get(this.selectionKey);
    if (remembered !== undefined && Number.isInteger(remembered) && Number.isFinite(remembered)) {
      this.selection = this.clampIndex(remembered);
    }
  }

  private rememberSelection(): void {
    if (this.selectionKey !== null) {
      this.selectionMemory.set(this.selectionKey, this.selection);
    }
  }

  private clampIndex(index: number): number {
    const lastIndex = this.parsedDocument.tabs.length - 1;
    const current = Math.max(0, Math.min(this.selection, lastIndex));
    if (!Number.isFinite(index) || !Number.isInteger(index)) {
      return current;
    }
    return Math.max(0, Math.min(index, lastIndex));
  }

  private renderTitlesAndAction(): void {
    this.tabs = this.parsedDocument.tabs.map((tab, index) => {
      const button = this.listEl.createEl('button', {
        cls: 'tabbed__tab',
        attr: {
          id: `tabbed-${this.instanceId}-tab-${index}`,
          role: 'tab',
          type: 'button',
          'data-tab-index': String(index),
        },
      });
      const title = button.createSpan({ cls: 'tabbed__title' });
      const child = this.addChild(new Component());
      this.titleChildren.push(child);
      this.renderTitle(tab.title, title, child, index).catch((error: unknown) => {
        logError('Could not finish rendering tab title', this.errorContext(index, error));
      });
      return button;
    });
    this.renderAction();
    this.updateTabState(this.body?.panelEl ?? null);
  }

  private renderAction(): void {
    if (this.locatorValue === null || this.parsedDocument.options.action === 'none') {
      return;
    }
    const action = this.parsedDocument.options.action;
    const actionEl = this.listEl.createEl('button', {
      cls: 'tabbed__action',
      attr: {
        type: 'button',
        'aria-label': action === 'add' ? 'Add tab' : 'Edit tab',
        'data-tab-action': action,
      },
    });
    setIcon(actionEl, action === 'add' ? 'plus' : 'pencil');
  }

  private disposeTitles(): void {
    for (const child of this.titleChildren) {
      this.removeChild(child);
    }
    this.titleChildren = [];
    this.tabs = [];
    this.listEl.empty();
  }

  private async renderTitle(
    markdown: string,
    titleEl: HTMLElement,
    child: Component,
    index: number,
  ): Promise<void> {
    try {
      await this.renderer(this.app, markdown, titleEl, this.sourcePath, child);
    } catch (error) {
      logError('Could not render tab title', this.errorContext(index, error));
    }
  }

  private registerInteractions(): void {
    this.registerDomEvent(this.listEl, 'click', (event) => {
      const action = this.actionFromEvent(event);
      if (action === 'add') {
        this.host.addTab(this);
        return;
      }
      if (action === 'edit') {
        this.host.editTab(this, this.selection);
        return;
      }
      const index = this.tabIndexFromEvent(event);
      if (index !== null) {
        this.startActivation(index);
      }
    });

    this.registerDomEvent(this.listEl, 'keydown', (event) => {
      const index = this.tabIndexFromEvent(event);
      if (index === null) {
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.startActivation(index);
        return;
      }
      const focusIndex = this.focusIndexForKey(index, event.key);
      if (focusIndex !== null) {
        event.preventDefault();
        this.tabs[focusIndex]?.focus();
      }
    });
  }

  private reconcileMutationInteractions(): void {
    if (this.locatorValue === null) {
      if (this.mutationInteractions !== null) {
        this.removeChild(this.mutationInteractions);
        this.mutationInteractions = null;
      }
      return;
    }
    if (this.mutationInteractions !== null) {
      return;
    }

    const interactions = this.addChild(new Component());
    this.mutationInteractions = interactions;
    interactions.registerDomEvent(this.listEl, 'contextmenu', (event) => {
      if (this.locatorValue === null) {
        return;
      }
      const index = this.tabIndexFromEvent(event);
      if (index !== null) {
        event.preventDefault();
        this.host.openTabMenu(this, index, event);
      }
    });
    interactions.registerDomEvent(this.rootEl, 'dblclick', (event) => {
      if (
        this.locatorValue !== null &&
        this.settings.doubleClickToEdit &&
        event.target instanceof Element &&
        this.body?.panelEl.contains(event.target) === true
      ) {
        this.host.editTab(this, this.selection);
      }
    });
  }

  private actionFromEvent(event: MouseEvent): 'add' | 'edit' | null {
    if (this.locatorValue === null || !(event.target instanceof Element)) {
      return null;
    }
    const actionEl = event.target.closest<HTMLElement>('[data-tab-action]');
    if (actionEl === null || !this.listEl.contains(actionEl)) {
      return null;
    }
    const action = actionEl.dataset['tabAction'];
    return action === 'add' || action === 'edit' ? action : null;
  }

  private tabIndexFromEvent(event: Event): number | null {
    if (!(event.target instanceof Element)) {
      return null;
    }
    const tab = event.target.closest<HTMLElement>('.tabbed__tab');
    if (tab === null || !this.listEl.contains(tab)) {
      return null;
    }
    const index = Number(tab.dataset['tabIndex']);
    return Number.isInteger(index) && index >= 0 && index < this.tabs.length ? index : null;
  }

  private focusIndexForKey(index: number, key: string): number | null {
    if (key === 'Home') {
      return 0;
    }
    if (key === 'End') {
      return this.tabs.length - 1;
    }
    const vertical =
      this.parsedDocument.options.position === 'left' ||
      this.parsedDocument.options.position === 'right';
    const previous = vertical ? 'ArrowUp' : 'ArrowLeft';
    const next = vertical ? 'ArrowDown' : 'ArrowRight';
    if (key !== previous && key !== next) {
      return null;
    }
    const delta = key === previous ? -1 : 1;
    return (index + delta + this.tabs.length) % this.tabs.length;
  }

  private updateTabState(panel: HTMLElement | null): void {
    for (const [index, tab] of this.tabs.entries()) {
      const selected = index === this.selection;
      tab.toggleClass('is-active', selected);
      tab.setAttribute('aria-selected', String(selected));
      tab.setAttribute('tabindex', selected ? '0' : '-1');
      if (selected && panel !== null) {
        tab.setAttribute('aria-controls', panel.id);
      } else {
        tab.removeAttribute('aria-controls');
      }
    }
    const selectedTab = this.tabs[this.selection];
    if (panel !== null && selectedTab !== undefined) {
      panel.setAttribute('aria-labelledby', selectedTab.id);
    }
  }

  private applyShell(): void {
    this.rootEl.removeClass(...positionClasses, ...lineClasses, ...borderClasses);
    this.rootEl.addClass(`tabbed--${this.parsedDocument.options.position}`);
    this.rootEl.addClass(`tabbed--${this.parsedDocument.options.lineMode}`);
    this.rootEl.addClass(`tabbed--border-${this.settings.border}`);
    this.rootEl.toggleClass('tabbed--limit-title-width', this.settings.limitTitleWidth);
    this.rootEl.style.setProperty('--tabbed-border-color', this.settings.borderColor);
    this.rootEl.style.setProperty('--tabbed-content-padding', this.settings.contentPadding);
    this.rootEl.style.setProperty('--tabbed-content-max-height', this.settings.contentMaxHeight);
    this.listEl.setAttribute(
      'aria-orientation',
      this.parsedDocument.options.position === 'left' ||
        this.parsedDocument.options.position === 'right'
        ? 'vertical'
        : 'horizontal',
    );
    this.arrangeChildren();
  }

  private arrangeChildren(): void {
    const panel = this.body?.panelEl;
    if (panel === undefined) {
      this.rootEl.append(this.listEl);
      return;
    }
    const panelFirst =
      this.parsedDocument.options.position === 'bottom' ||
      this.parsedDocument.options.position === 'right';
    this.rootEl.append(...(panelFirst ? [panel, this.listEl] : [this.listEl, panel]));
  }

  private syntaxSettingsChanged(settings: TabbedSettings): boolean {
    return (
      settings.separator !== this.settings.separator ||
      settings.defaultTitle !== this.settings.defaultTitle ||
      settings.defaultContent !== this.settings.defaultContent ||
      settings.titlePosition !== this.settings.titlePosition ||
      settings.titleLineMode !== this.settings.titleLineMode ||
      settings.action !== this.settings.action
    );
  }

  private errorContext(index: number, error: unknown): Record<string, unknown> {
    return {
      path: this.sourcePath,
      ...(this.sectionLine === null ? {} : { line: this.sectionLine }),
      index,
      cause: formatError(error),
    };
  }

  private updateHostMarker(): void {
    this.hostWrapperEl?.toggleClass('tabbed-host', this.settings.hideNativeEditButton);
  }

  private startActivation(index: number): void {
    this.activate(index).catch((error: unknown) => {
      logError('Could not activate tab', this.errorContext(index, error));
    });
  }
}
