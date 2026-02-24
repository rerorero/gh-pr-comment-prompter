export interface CommentContext {
  filePath: string;
  branchName: string;
  prNumber: string;
  lineNumber: string;
  comment: string;
  owner: string;
  repo: string;
}

export const DEFAULT_TEMPLATE = `Address this GitHub PR review comment:

File: {{filePath}}
Line: {{lineNumber}}

{{comment}}`;

export const INJECTED_ATTR = 'data-pr-prompter-injected';
export const STORAGE_KEY = 'promptTemplate';
