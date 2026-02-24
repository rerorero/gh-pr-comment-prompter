import type { CommentContext } from './types';

const VARIABLE_MAP: Record<string, keyof CommentContext> = {
  filePath: 'filePath',
  branchName: 'branchName',
  prNumber: 'prNumber',
  lineNumber: 'lineNumber',
  comment: 'comment',
  owner: 'owner',
  repo: 'repo',
};

export function renderTemplate(template: string, ctx: CommentContext): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const field = VARIABLE_MAP[key];
    if (!field) return match;
    return ctx[field];
  });
}
