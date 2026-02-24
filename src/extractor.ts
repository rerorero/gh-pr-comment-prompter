import type { CommentContext } from './types';

/** Strip Unicode formatting characters (e.g. U+200E LTR mark injected by GitHub). */
function stripFormatChars(s: string): string {
  return s.replace(/\p{Cf}/gu, '').trim();
}

/** Parse owner, repo, PR number from URL: /owner/repo/pull/prNumber */
function parseUrl(): Pick<CommentContext, 'owner' | 'repo' | 'prNumber'> {
  const parts = window.location.pathname.split('/').filter(Boolean);
  return {
    owner: parts[0] ?? '',
    repo: parts[1] ?? '',
    prNumber: parts[3] ?? '',
  };
}

/**
 * Extract the head branch name.
 *
 * GitHub renders this differently depending on which tab is active:
 *
 * - Files tab (legacy HTML): The head ref is in a `<span class="...head-ref">` container.
 *   Selector: `.commit-ref.head-ref a`
 *
 * - Conversation tab (React UI): Two `a[class*="BranchName"]` links appear;
 *   index 0 = base branch, index 1 = head branch.
 *
 * Confirmed by DOM inspection.
 */
function getBranchName(): string {
  // Files tab: look for the .head-ref span
  const headRefLink = document.querySelector<HTMLAnchorElement>('.commit-ref.head-ref a');
  if (headRefLink) return headRefLink.textContent?.trim() ?? '';

  // Conversation tab: second BranchName link is the head branch
  const branchLinks = document.querySelectorAll<HTMLAnchorElement>('a[class*="BranchName"]');
  return branchLinks[1]?.textContent?.trim() ?? '';
}

/**
 * Extract file path for inline review comments.
 *
 * Strategy 1 (Files tab, legacy HTML): The comment is nested inside a `.file.js-file`
 * container whose header has a `data-path` attribute.
 *
 * Strategy 2 (Conversation tab): The comment is inside a
 * `details.review-thread-component` element whose `<summary>` text content
 * is the file path.
 *
 * Strategy 3 (/changes React UI): The comment is inside a `#diff-{hash}`
 * container whose header has an `<h3> <a>` element with the file path as text.
 */
function getFilePath(commentEl: Element): string {
  // Strategy 1: legacy diff view
  const fileContainer = commentEl.closest('.file.js-file');
  const filePath = fileContainer?.querySelector<HTMLElement>('[data-path]')?.getAttribute('data-path');
  if (filePath) return filePath;

  // Strategy 2: conversation tab — file path is in the summary of the review thread
  const summary = commentEl.closest('details.review-thread-component')?.querySelector('summary');
  const summaryText = summary?.textContent ? stripFormatChars(summary.textContent) : '';
  if (summaryText) return summaryText;

  // Strategy 3: /changes React UI — file path is in h3 > a inside the #diff-{hash} container
  const diffContainer = commentEl.closest('[id^="diff-"]');
  const fileLink = diffContainer?.querySelector<HTMLAnchorElement>('h3 a');
  return fileLink?.textContent ? stripFormatChars(fileLink.textContent) : '';
}

/**
 * Extract line number for inline review comments.
 *
 * Strategy 1 (Files tab, legacy HTML): The comment is in a <tr>. The immediately
 * preceding <tr> contains the diff code line with `<td data-line-number="N">`.
 *
 * Strategy 2 (Conversation tab): The comment is inside a
 * `details.review-thread-component` that contains a mini diff snippet with
 * `<td class="blob-num-addition" data-line-number="N">`.
 */
function getLineNumber(commentEl: Element): string {
  const tr = commentEl.closest('tr');
  if (tr) {
    // Strategy 1a: React UI (/changes) — comment is embedded inside the diff row.
    // Line number cell has class new-diff-line-number (not present in legacy HTML).
    const reactCell = tr.querySelector<HTMLElement>('td.new-diff-line-number[data-line-number]');
    if (reactCell) return reactCell.getAttribute('data-line-number') ?? '';

    // Strategy 1b: legacy HTML (/files) — comment is in a separate row after the diff row.
    const prevTr = tr.previousElementSibling;
    if (prevTr) {
      const additionCell = prevTr.querySelector<HTMLElement>(
        'td.blob-num-addition[data-line-number], td.blob-num-context[data-line-number]'
      );
      if (additionCell) return additionCell.getAttribute('data-line-number') ?? '';
      const anyCell = prevTr.querySelector<HTMLElement>('td[data-line-number]');
      if (anyCell) return anyCell.getAttribute('data-line-number') ?? '';
    }
  }

  // Strategy 2: conversation tab — addition line in the embedded diff snippet
  const details = commentEl.closest('details.review-thread-component');
  if (details) {
    const additionCell = details.querySelector<HTMLElement>(
      'td.blob-num-addition[data-line-number], td.blob-num-context[data-line-number]'
    );
    if (additionCell) return additionCell.getAttribute('data-line-number') ?? '';
    const anyCell = details.querySelector<HTMLElement>('td[data-line-number]');
    return anyCell?.getAttribute('data-line-number') ?? '';
  }

  return '';
}

/** Extract the plain-text body of a comment. */
function getCommentText(commentEl: Element): string {
  const body = commentEl.querySelector('.comment-body');
  return body?.textContent?.trim() ?? '';
}

export function extractContext(commentEl: Element): CommentContext {
  const { owner, repo, prNumber } = parseUrl();
  return {
    owner,
    repo,
    prNumber,
    branchName: getBranchName(),
    filePath: getFilePath(commentEl),
    lineNumber: getLineNumber(commentEl),
    comment: getCommentText(commentEl),
  };
}
