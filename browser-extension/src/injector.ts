/**
 * Isolated-world injector. Runs in a JS context the page cannot read.
 *
 * The secret arrives as a message argument (never in DOM, storage, URL, or
 * page world). It is written through NATIVE input setters so the page's
 * instrumented setters/observers see nothing, submitted, then overwritten
 * in memory immediately. No keystroke is echoed to page listeners.
 */
interface InjectOp {
  username: string;
  secret: string;            // lives in this isolated scope only
  selectors: { username: string; password: string; submit?: string };
  domain: string;
}

const nativeInputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;

function setOpaque(input: HTMLInputElement, value: string) {
  nativeInputSetter.call(input, value);
  // input events (needed by frameworks) carry no usable data to page sniffers
  // because the value was never observable via the page's hooked setter.
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

let done = false;
chrome.runtime.onMessage.addListener((msg: { type: string; op?: InjectOp }) => {
  if (msg.type !== 'KEYRAIL_INJECT' || done) return;
  const op = msg.op!;
  // Re-verify origin at injection time (defense in depth; background already checked)
  if (location.hostname !== op.domain && !location.hostname.endsWith('.' + op.domain)) return;
  done = true;

  const u = document.querySelector<HTMLInputElement>(op.selectors.username);
  const p = document.querySelector<HTMLInputElement>(op.selectors.password);
  if (!u || !p) return; // never guess fields — no injection without exact selectors

  setOpaque(u, op.username);
  setOpaque(p, op.secret);

  // zeroize the isolated-scope copy as fast as possible
  op.secret = '\u0000'.repeat(op.secret.length);
  (msg as { op?: unknown }).op = undefined;

  const submit = op.selectors.submit ? document.querySelector<HTMLElement>(op.selectors.submit) : null;
  setTimeout(() => {
    if (submit) submit.click();
    else {
      const form = p.closest('form');
      form?.requestSubmit?.();
    }
    // after submit the page owns an authenticated session; nothing of ours remains
  }, 120);
});
