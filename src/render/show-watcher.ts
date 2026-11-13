// A note open in Reading view keeps a hidden Live Preview editor of the same note, and that
// editor runs the same code block processors, so every tabs block renders a second copy there.
export interface ShowWatcher {
  // True only for a block inside that hidden editor, and only when `whenShown` can tell when
  // it appears. A detached element is not one: Obsidian renders sections before attaching
  // them, and PDF export prints from a hidden window soon after rendering, so waiting there
  // would leave tabs empty in the PDF.
  shouldWait(element: HTMLElement): boolean;
  // Calls `callback` once, at the first layout where `element` has a layout box.
  // Returns a function that cancels.
  whenShown(element: HTMLElement, callback: () => void): () => void;
}

function hasLayoutBox(element: HTMLElement): boolean {
  return element.isConnected && element.getClientRects().length > 0;
}

function resizeObserverFor(element: HTMLElement): typeof ResizeObserver | undefined {
  return element.ownerDocument.defaultView?.ResizeObserver;
}

export const layoutShowWatcher: ShowWatcher = {
  shouldWait(element) {
    return (
      resizeObserverFor(element) !== undefined &&
      element.isConnected &&
      element.closest('.markdown-source-view') !== null &&
      !hasLayoutBox(element)
    );
  },
  whenShown(element, callback) {
    const Observer = resizeObserverFor(element);
    if (Observer === undefined) {
      // `shouldWait` never asks to wait without an observer; render rather than hang.
      callback();
      return () => undefined;
    }
    let waiting = true;
    // A display: none subtree reports a 0×0 box; showing it reports the real size.
    const observer = new Observer(() => {
      if (!waiting || !hasLayoutBox(element)) {
        return;
      }
      waiting = false;
      observer.disconnect();
      callback();
    });
    observer.observe(element);
    return () => {
      waiting = false;
      observer.disconnect();
    };
  },
};
