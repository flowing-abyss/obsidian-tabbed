import type { App } from 'obsidian';
import { renderMarkdown, type RenderMarkdown } from './markdown-renderer.js';
import { RenderScope } from './render-scope.js';

export class ColumnBody extends RenderScope {
  private readonly app: App;
  readonly contentEl: HTMLElement;
  private readonly markdown: string;
  private readonly sourcePath: string;
  private readonly renderer: RenderMarkdown;

  constructor(
    ...[app, contentEl, markdown, sourcePath, renderer = renderMarkdown]: [
      App,
      HTMLElement,
      string,
      string,
      RenderMarkdown?,
    ]
  ) {
    super();
    this.app = app;
    this.contentEl = contentEl;
    this.markdown = markdown;
    this.sourcePath = sourcePath;
    this.renderer = renderer;
  }

  render(): Promise<void> {
    return this.renderer(this.app, this.markdown, this.contentEl, this.sourcePath, this);
  }
}
