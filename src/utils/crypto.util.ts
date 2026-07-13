import crypto from "node:crypto";

export function verifyGitHubWebhookSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  secret: string
): boolean {
  if (!signatureHeader || !secret) {
    return false;
  }

  const body = typeof rawBody === "string" ? Buffer.from(rawBody) : rawBody;
  const digest = crypto.createHmac("sha256", secret).update(body).digest("hex");
  const expectedSignature = `sha256=${digest}`;

  const signatureBuffer = Buffer.from(signatureHeader);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (signatureBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
}

