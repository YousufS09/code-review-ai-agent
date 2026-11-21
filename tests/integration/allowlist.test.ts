import crypto from "node:crypto";

process.env.ALLOWED_GITHUB_OWNERS = "Allowed-Org";

const mockEnqueueReview = jest.fn().mockResolvedValue(undefined);

jest.mock("../../src/config/queue", () => ({ enqueueReview: mockEnqueueReview }));

import request from "supertest";
import { app } from "../../src/app";

function signedRequest(ownerLogin: string) {
  const body = JSON.stringify({
    action: "opened",
    installation: { id: 1 },
    repository: { name: "demo", owner: { login: ownerLogin } },
    pull_request: { number: 1, head: { sha: "abc123" } },
    sender: { login: ownerLogin }
  });
  const signature = `sha256=${crypto.createHmac("sha256", "test-webhook-secret").update(body).digest("hex")}`;

  return request(app)
    .post("/webhooks/github")
    .set("content-type", "application/json")
    .set("x-github-event", "pull_request")
    .set("x-github-delivery", `delivery-${ownerLogin}`)
    .set("x-hub-signature-256", signature)
    .send(body);
}

describe("ALLOWED_GITHUB_OWNERS", () => {
  afterAll(() => {
    delete process.env.ALLOWED_GITHUB_OWNERS;
  });

  it("ignores webhooks from owners that are not allowed", async () => {
    const response = await signedRequest("someone-else");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true, ignored: true });
    expect(mockEnqueueReview).not.toHaveBeenCalled();
  });

  it("accepts allowed owners case-insensitively", async () => {
    const response = await signedRequest("allowed-org");

    expect(response.status).toBe(202);
    expect(mockEnqueueReview).toHaveBeenCalledTimes(1);
  });
});
