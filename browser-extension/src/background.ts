/**
 * Service worker — the only place a launch grant token may exist, and only
 * in memory. Rules enforced here:
 *
 *  1. Tokens are never written to chrome.storage / IndexedDB / disk.
 *  2. Injection runs ONLY if the active tab's hostname strictly matches the
 *     grant's bound domain (allowlist). A page asking for credentials can
 *     never trigger injection — only an explicit user action in the popup.
 *  3. The secret is handed to an ISOLATED-world script as a function
 *     argument; page JavaScript cannot read it. It is wiped after submit.
 */
const API = 'https://pam.keyrail.cloud/api';

interface PendingGrant {
  grantId: string;
  token: string;       // single-use, 30s — held in memory only
  domain: string;      // strict allowlist
  applicationId: string;
  expiresAt: number;
}

let pending: PendingGrant | null = null;

/** Popup reports that the PAM portal issued a grant for the user. */
chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  if (msg.type === 'GRANT_ISSUED') {
    pending = { ...msg.grant, expiresAt: Date.now() + msg.grant.expiresIn * 1000 };
    send({ ok: true });
    chrome.action.setBadgeText({ text: '●' });
    chrome.action.setBadgeBackgroundColor({ color: '#3ad6b5' });
  }

  if (msg.type === 'LAUNCH_CLICKED') {
    (async () => {
      if (!pending) return send({ ok: false, error: 'No active launch grant. Open the app from the Keyrail portal first.' });
      if (Date.now() > pending.expiresAt) { pending = null; return send({ ok: false, error: 'Grant expired — start a new launch from the portal.' }); }

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const host = tab?.url ? new URL(tab.url).hostname : '';
      // ---- domain allowlist: the core anti-phishing / anti-exfil control ----
      if (!host || !(host === pending.domain || host.endsWith('.' + pending.domain))) {
        send({ ok: false, error: `Blocked: grant is bound to ${pending.domain}, active tab is "${host || 'unknown'}".` });
        return;
      }

      // Consume the single-use grant server-side; the broker returns an
      // injection program (selectors + an opaque secret handle id), NOT the secret.
      const res = await fetch(`${API}/launch/consume-connector`, {
        method: 'POST',
        credentials: 'include', // HttpOnly session cookie — no tokens in storage
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: pending.token, grantId: pending.grantId, kind: 'web-inject', observedDomain: host }),
      });
      pending = null; // consumed or dead either way
      chrome.action.setBadgeText({ text: '' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return send({ ok: false, error: body.message ?? 'Launch rejected by broker' });
      }
      const op = await res.json(); // { username, secretHandle, selectors } — secretHandle is a one-shot broker reference

      await chrome.scripting.executeScript({
        target: { tabId: tab!.id! },
        world: 'ISOLATED',                 // page JS cannot see this scope
        files: ['dist/injector.js'],
      });
      await chrome.tabs.sendMessage(tab!.id!, { type: 'KEYRAIL_INJECT', op });
      send({ ok: true, domain: host });
    })();
    return true; // async send
  }
});

// Never leak grant state to content scripts or pages.
chrome.runtime.onMessageExternal?.addListener((_msg, _sender, send) => send({ ok: false }));
