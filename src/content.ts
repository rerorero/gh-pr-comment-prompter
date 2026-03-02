import { extractContext } from './extractor';
import { renderTemplate } from './template';
import { DEFAULT_TEMPLATE, INJECTED_ATTR, STORAGE_KEY } from './types';

const ERR = (...args: unknown[]) => console.error('[PR-Prompter]', ...args);

// SVG: sparkle / 4-pointed star icon (AI indicator)
const ICON_SVG = `<svg aria-hidden="true" height="16" width="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M8 1 Q9.5 6.5 15 8 Q9.5 9.5 8 15 Q6.5 9.5 1 8 Q6.5 6.5 8 1 Z"/>
  <circle cx="13" cy="3" r="1"/>
</svg>`;

// SVG: checkmark icon for success state
const CHECK_SVG = `<svg aria-hidden="true" height="16" width="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/>
</svg>`;

function createButton(): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'timeline-comment-action Link--secondary Button--link Button--medium Button';
  btn.setAttribute('aria-label', 'Copy prompt for coding agent');
  btn.title = 'Copy prompt for coding agent';
  btn.innerHTML = `<span class="Button-content"><span class="Button-label">${ICON_SVG}</span></span>`;
  return btn;
}

function showCopiedFeedback(btn: HTMLButtonElement): void {
  const originalHTML = btn.innerHTML;
  btn.innerHTML = `<span class="Button-content"><span class="Button-label">${CHECK_SVG}</span></span>`;
  btn.style.color = 'var(--color-success-fg, #1a7f37)';
  setTimeout(() => {
    btn.innerHTML = originalHTML;
    btn.style.color = '';
  }, 2000);
}

async function getTemplate(): Promise<string> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (val: string) => {
      if (!done) { done = true; resolve(val); }
    };
    // Timeout fallback: if chrome.storage never responds (invalidated context), use default
    setTimeout(() => finish(DEFAULT_TEMPLATE), 2000);
    try {
      chrome.storage.sync.get({ [STORAGE_KEY]: DEFAULT_TEMPLATE }, (items) => {
        if (chrome.runtime.lastError) {
          ERR('storage.sync.get error:', chrome.runtime.lastError.message);
          finish(DEFAULT_TEMPLATE);
          return;
        }
        finish(items[STORAGE_KEY] as string);
      });
    } catch (err) {
      ERR('storage unavailable (extension context invalidated?), using default:', err);
      finish(DEFAULT_TEMPLATE);
    }
  });
}

function attachClickHandler(btn: HTMLButtonElement, commentEl: Element): void {
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const template = await getTemplate();
    const ctx = extractContext(commentEl);
    const prompt = renderTemplate(template, ctx);

    try {
      await navigator.clipboard.writeText(prompt);
      showCopiedFeedback(btn);
    } catch (err) {
      ERR('clipboard API failed, trying execCommand:', err);
      try {
        const ta = document.createElement('textarea');
        ta.value = prompt;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showCopiedFeedback(btn);
      } catch (err2) {
        ERR('execCommand also failed:', err2);
      }
    }
  });
}

function injectButton(commentEl: Element): void {
  if (commentEl.hasAttribute(INJECTED_ATTR)) {
    // Attribute is set but verify the button still exists in the DOM.
    // GitHub's Turbo morphing can replace action areas while keeping custom attributes.
    if (commentEl.querySelector('button[aria-label="Copy prompt for coding agent"]')) {
      return;
    }
    // Button was removed; fall through to re-inject.
  }
  commentEl.setAttribute(INJECTED_ATTR, 'true');

  const btn = createButton();
  attachClickHandler(btn, commentEl);

  // Strategy 1: Legacy HTML — inject before the ⋯ <details> inside .timeline-comment-actions
  const actionsArea = commentEl.querySelector('div.timeline-comment-actions');
  const detailsEl = actionsArea?.querySelector('details');
  if (detailsEl) {
    detailsEl.insertAdjacentElement('beforebegin', btn);
    return;
  }

  // Strategy 2: React UI (/changes) — inject before the kebab button (⋯)
  const kebabSvg = commentEl.querySelector('svg.octicon-kebab-horizontal');
  const kebabBtn = kebabSvg?.closest('button');
  if (kebabBtn) {
    kebabBtn.insertAdjacentElement('beforebegin', btn);
    return;
  }

  // Strategy 3: React UI fallback — float the button before the comment body
  const mdBody = commentEl.querySelector('.markdown-body');
  if (mdBody) {
    btn.style.cssText = 'float:right;margin:0 4px 4px;';
    mdBody.insertAdjacentElement('beforebegin', btn);
    return;
  }
}

function findComments(): Element[] {
  // Strategy 1: Legacy HTML — inline review comments and PR review summaries.
  //   div#discussion_rXXX.timeline-comment-group.unminimized-comment
  //   div#pullrequestreview-XXX.timeline-comment-group.unminimized-comment
  const reviewComments = Array.from(
    document.querySelectorAll('.timeline-comment-group.unminimized-comment')
  ).filter((el) => {
    const id = el.id;
    // Exclude PR description (id="pullrequest-XXXXXXX") but keep
    // PR reviews (id="pullrequestreview-XXXXXXX") and discussion comments.
    return !id.startsWith('pullrequest-') || id.startsWith('pullrequestreview-');
  });

  // Strategy 2: Legacy HTML — regular PR/issue comments.
  //   div#issuecomment-XXX.timeline-comment-group  (no unminimized-comment on outer)
  //     div.timeline-comment.unminimized-comment   (unminimized-comment is a child)
  const issueComments = Array.from(
    document.querySelectorAll('[id^="issuecomment-"].timeline-comment-group')
  ).filter((el) => !!el.querySelector('.unminimized-comment'));

  // Strategy 3: React UI (/changes) — inline review comments don't have
  // .unminimized-comment but still carry a comment ID (rXXXXXXX) on an ancestor
  // element. Walk up from any .markdown-body to find that container.
  const seen = new Set<Element>([...reviewComments, ...issueComments]);
  const reactComments: Element[] = [];
  document.querySelectorAll('.markdown-body').forEach((md) => {
    let el: Element | null = md.parentElement;
    while (el && el !== document.body) {
      // Comment IDs: "rXXXXXXX" (inline review) or already covered above
      if (/^r\d{5,}$/.test(el.id)) {
        if (!seen.has(el)) {
          seen.add(el);
          reactComments.push(el);
        }
        return;
      }
      el = el.parentElement;
    }
  });

  return [...reviewComments, ...issueComments, ...reactComments];
}

function processAll(): void {
  findComments().forEach(injectButton);
}

function startObserver(): void {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof Element) {
          const isLegacy =
            node.classList.contains('unminimized-comment') ||
            !!node.querySelector?.('.unminimized-comment');
          const isReact =
            node.classList.contains('markdown-body') ||
            !!node.querySelector?.('.markdown-body');
          if (isLegacy || isReact) {
            processAll();
            return;
          }
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

function init(): void {
  processAll();
  startObserver();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

document.addEventListener('turbo:load', processAll);
document.addEventListener('turbo:render', processAll);
