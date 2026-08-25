/** Popup: explicit user confirmation before any injection. */
const $ = (id: string) => document.getElementById(id)!;

async function refresh() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  $('tab').textContent = tab?.url ? new URL(tab.url).hostname : '—';
  const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' }).catch(() => null);
  if (state?.grant) {
    $('domain').textContent = state.grant.domain;
    const left = Math.max(0, Math.ceil((state.grant.expiresAt - Date.now()) / 1000));
    $('ttl').textContent = `${left}s`;
    ($('launch') as HTMLButtonElement).disabled = left === 0;
  } else {
    $('domain').textContent = 'no active grant';
    $('ttl').textContent = '—';
    ($('launch') as HTMLButtonElement).disabled = true;
  }
}

$('launch').addEventListener('click', async () => {
  const res = await chrome.runtime.sendMessage({ type: 'LAUNCH_CLICKED' });
  $('msg').textContent = res?.ok ? '' : (res?.error ?? 'Failed');
  if (res?.ok) window.close();
  else refresh();
});

refresh();
setInterval(refresh, 1000);
