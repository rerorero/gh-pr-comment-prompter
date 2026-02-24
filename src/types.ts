export interface CommentContext {
  filePath: string;
  branchName: string;
  prNumber: string;
  lineNumber: string;
  comment: string;
  owner: string;
  repo: string;
}

export const DEFAULT_TEMPLATE = `Please address the following GitHub PR review comment:

File: {{filePath}}
Line: {{lineNumber}}

Comment:
{{comment}}

Please make the necessary code changes to address this review comment.`;

export const INJECTED_ATTR = 'data-pr-prompter-injected';
export const STORAGE_KEY = 'promptTemplate';
