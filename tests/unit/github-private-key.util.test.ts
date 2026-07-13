import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  normalizeGitHubPrivateKey,
  normalizeGitHubSecretValue,
  readGitHubPrivateKeyFromEnvFile
} from "../../src/utils/github-private-key.util";

describe("github private key utilities", () => {
  it("normalizes escaped newlines and surrounding quotes", () => {
    expect(normalizeGitHubPrivateKey('"-----BEGIN RSA PRIVATE KEY-----\\nabc\\n-----END RSA PRIVATE KEY-----"')).toBe(
      "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----"
    );
  });

  it("normalizes webhook secret values with whitespace and quotes", () => {
    expect(normalizeGitHubSecretValue('  "my-webhook-secret"  ')).toBe("my-webhook-secret");
  });

  it("reconstructs a multiline private key from an env file", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "github-key-"));
    const tempEnvPath = path.join(tempDir, ".env");

    fs.writeFileSync(
      tempEnvPath,
      [
        "NODE_ENV=development",
        "GITHUB_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----",
        "line-1",
        "line-2",
        "-----END RSA PRIVATE KEY-----",
        "GROQ_API_KEY=test"
      ].join("\n"),
      "utf8"
    );

    expect(readGitHubPrivateKeyFromEnvFile(tempEnvPath)).toBe(
      "-----BEGIN RSA PRIVATE KEY-----\nline-1\nline-2\n-----END RSA PRIVATE KEY-----"
    );

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
