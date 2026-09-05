import { MarkdownRenderer, type App, type Component } from 'obsidian';

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
