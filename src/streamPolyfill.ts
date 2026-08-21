/*
 *  WKWebView (Safari engine) does not implement async iteration over
 *  ReadableStream — `for await (const chunk of stream)` throws
 *  "TypeError: undefined is not a function". pdf.js v6 relies on it in
 *  PDFPageProxy.getTextContent() and in its CompressionStream path, so
 *  "Edit text" (and anything else consuming pdf.js streams) breaks in the
 *  desktop app while working fine in Chrome. Install the standard
 *  async-iterator protocol on ReadableStream before any pdf.js code runs.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export function installReadableStreamAsyncIterator(): void {
  const proto =
    typeof ReadableStream !== 'undefined' ? (ReadableStream.prototype as any) : null;
  if (!proto || typeof proto[Symbol.asyncIterator] === 'function') return;

  function values(this: ReadableStream, { preventCancel = false } = {}) {
    const reader = this.getReader();
    let done = false;
    return {
      async next(): Promise<IteratorResult<any>> {
        if (done) return { done: true, value: undefined };
        try {
          const r = await reader.read();
          if (r.done) {
            done = true;
            reader.releaseLock();
            return { done: true, value: undefined };
          }
          return { done: false, value: r.value };
        } catch (err) {
          done = true;
          reader.releaseLock();
          throw err;
        }
      },
      async return(value?: any): Promise<IteratorResult<any>> {
        if (!done) {
          done = true;
          try {
            if (!preventCancel) await reader.cancel();
          } finally {
            reader.releaseLock();
          }
        }
        return { done: true, value };
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }

  Object.defineProperty(proto, 'values', {
    value: values,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(proto, Symbol.asyncIterator, {
    value: values,
    writable: true,
    configurable: true,
  });
}

installReadableStreamAsyncIterator();
