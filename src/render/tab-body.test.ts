import { MarkdownRenderer } from 'obsidian';
import { App } from 'obsidian-test-mocks/obsidian';
import { describe, expect, it, vi } from 'vitest';
import { TabBody, renderMarkdown, type RenderMarkdown } from './tab-body.js';

describe('renderMarkdown', () => {
  it('delegates to the public five-argument MarkdownRenderer.render API', async () => {
    const app = App.createConfigured__().asOriginalType__();
    const panel = createDiv();
    const render = vi.spyOn(MarkdownRenderer, 'render').mockResolvedValue(undefined);
    const body = new TabBody(app, panel, 'body', 'Note.md');

    await renderMarkdown(app, 'body', panel, 'Note.md', body);

    expect(render).toHaveBeenCalledWith(app, 'body', panel, 'Note.md', body);
  });
});

describe('TabBody', () => {
  it('renders its Markdown into its owned panel with itself as lifecycle component', async () => {
    const app = App.createConfigured__().asOriginalType__();
    const panel = createDiv();
    const renderer = vi.fn<RenderMarkdown>().mockResolvedValue(undefined);
    const body = new TabBody(app, panel, 'body', 'Note.md', renderer);

    await body.render();

    expect(body.panelEl).toBe(panel);
    expect(renderer).toHaveBeenCalledWith(app, 'body', panel, 'Note.md', body);
  });
});
