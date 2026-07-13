import crypto from "node:crypto";
import { verifyGitHubWebhookSignature } from "../../src/utils/crypto.util";

describe("verifyGitHubWebhookSignature", () => {
  it("accepts a valid GitHub signature", () => {
    const secret = "super-secret";
    const body = JSON.stringify({ hello: "world" });
    const signature = `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;

    expect(verifyGitHubWebhookSignature(Buffer.from(body), signature, secret)).toBe(true);
  });

  it("rejects an invalid GitHub signature", () => {
    expect(verifyGitHubWebhookSignature(Buffer.from("{}"), "sha256=bad", "super-secret")).toBe(false);
  });
});

