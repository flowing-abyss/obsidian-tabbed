import { Component, MarkdownRenderer, type App } from 'obsidian';

export type RenderMarkdown = (
  ...args: [
    app: App,
    markdown: string,
    element: HTMLElement,
    sourcePath: string,
    component: Component,
  ]
) => Promise<void>;

export const renderMarkdown: RenderMarkdown = (...args) => MarkdownRenderer.render(...args);

export class TabBody extends Component {
  private readonly app: App;
  readonly panelEl: HTMLElement;
  private readonly markdown: string;
  private readonly sourcePath: string;
  private readonly renderer: RenderMarkdown;

  constructor(
    ...[app, panelEl, markdown, sourcePath, renderer = renderMarkdown]: [
      App,
      HTMLElement,
      string,
      string,
      RenderMarkdown?,
    ]
  ) {
    super();
    this.app = app;
    this.panelEl = panelEl;
    this.markdown = markdown;
    this.sourcePath = sourcePath;
    this.renderer = renderer;
  }

  render(): Promise<void> {
    return this.renderer(this.app, this.markdown, this.panelEl, this.sourcePath, this);
  }
}
