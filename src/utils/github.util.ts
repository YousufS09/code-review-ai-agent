export const AI_CODE_REVIEW_MARKER = "<!-- ai-code-review-agent -->";

export function buildRepositoryFullName(owner: string, name: string): string {
  return `${owner}/${name}`;
}

export function buildPullRequestUrl(owner: string, name: string, number: number): string {
  return `https://github.com/${owner}/${name}/pull/${number}`;
}

export function formatNullableLine(line: number | null | undefined): string {
  return line === null || line === undefined ? "N/A" : String(line);
}

