import fs from "node:fs";

const GITHUB_PRIVATE_KEY_PREFIX = "GITHUB_PRIVATE_KEY=";
const ENV_ASSIGNMENT_PATTERN = /^[A-Z0-9_]+=/;

function stripMatchingQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  return value;
}

export function normalizeGitHubSecretValue(rawValue: string): string {
  return stripMatchingQuotes(rawValue.trim());
}

export function normalizeGitHubPrivateKey(rawValue: string): string {
  return normalizeGitHubSecretValue(rawValue).replace(/\\n/g, "\n");
}

export function readGitHubPrivateKeyFromEnvFile(envFilePath: string): string | undefined {
  if (!fs.existsSync(envFilePath)) {
    return undefined;
  }

  const fileContents = fs.readFileSync(envFilePath, "utf8");
  const lines = fileContents.split(/\r?\n/);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];

    if (!line.startsWith(GITHUB_PRIVATE_KEY_PREFIX)) {
      continue;
    }

    const inlineValue = line.slice(GITHUB_PRIVATE_KEY_PREFIX.length);
    const normalizedInlineValue = normalizeGitHubPrivateKey(inlineValue);

    if (normalizedInlineValue.includes("-----END")) {
      return normalizedInlineValue;
    }

    const valueLines = [inlineValue];

    for (let followIndex = lineIndex + 1; followIndex < lines.length; followIndex += 1) {
      const followLine = lines[followIndex];

      if (ENV_ASSIGNMENT_PATTERN.test(followLine) && !followLine.startsWith("-----")) {
        break;
      }

      valueLines.push(followLine);

      if (followLine.includes("-----END")) {
        break;
      }
    }

    return normalizeGitHubPrivateKey(valueLines.join("\n"));
  }

  return undefined;
}
