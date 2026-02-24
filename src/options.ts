import { DEFAULT_TEMPLATE, STORAGE_KEY } from './types';

const templateArea = document.getElementById('template') as HTMLTextAreaElement;
const saveBtn = document.getElementById('save') as HTMLButtonElement;
const resetBtn = document.getElementById('reset') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLSpanElement;

function showStatus(msg: string, isError = false): void {
  statusEl.textContent = msg;
  statusEl.style.color = isError
    ? 'var(--color-danger-fg, #cf222e)'
    : 'var(--color-success-fg, #1a7f37)';
  setTimeout(() => {
    statusEl.textContent = '';
  }, 2500);
}

// Load saved template on open
chrome.storage.sync.get({ [STORAGE_KEY]: DEFAULT_TEMPLATE }, (items) => {
  templateArea.value = items[STORAGE_KEY] as string;
});

saveBtn.addEventListener('click', () => {
  const value = templateArea.value;
  if (!value.trim()) {
    showStatus('Template cannot be empty.', true);
    return;
  }
  chrome.storage.sync.set({ [STORAGE_KEY]: value }, () => {
    showStatus('Saved!');
  });
});

resetBtn.addEventListener('click', () => {
  templateArea.value = DEFAULT_TEMPLATE;
  chrome.storage.sync.set({ [STORAGE_KEY]: DEFAULT_TEMPLATE }, () => {
    showStatus('Reset to default.');
  });
});
