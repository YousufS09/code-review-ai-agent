import crypto from "node:crypto";

const mockHandleWebhookEvent = jest.fn().mockResolvedValue({
  ignored: false,
  processed: true,
  reviewJobId: 1
});

jest.mock("../../src/services/review/review.service", () => {
  return {
    ReviewService: jest.fn().mockImplementation(() => ({
      handleWebhookEvent: mockHandleWebhookEvent
    }))
  };
});

import request from "supertest";
import { app } from "../../src/app";

describe("app", () => {
  beforeEach(() => {
    mockHandleWebhookEvent.mockClear();
  });

  it("serves the health endpoint", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("rejects a webhook with an invalid signature", async () => {
    const payload = {
      action: "opened",
      installation: { id: 1 },
      repository: {
        name: "demo",
        owner: { login: "octocat" }
      },
      pull_request: {
        number: 1,
        head: { sha: "abc123" }
      },
      sender: { login: "octocat" }
    };

    const response = await request(app)
      .post("/webhooks/github")
      .set("x-github-event", "pull_request")
      .set("x-github-delivery", "delivery-1")
      .set("x-hub-signature-256", "sha256=invalid")
      .send(payload);

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Invalid GitHub webhook signature");
  });

  it("accepts a valid pull request webhook before processing the review", async () => {
    const payload = {
      action: "reopened",
      installation: { id: 1 },
      repository: {
        name: "demo",
        owner: { login: "octocat" }
      },
      pull_request: {
        number: 1,
        head: { sha: "abc123" }
      },
      sender: { login: "octocat" }
    };
    const body = JSON.stringify(payload);
    const signature = `sha256=${crypto.createHmac("sha256", "test-webhook-secret").update(body).digest("hex")}`;

    const response = await request(app)
      .post("/webhooks/github")
      .set("content-type", "application/json")
      .set("x-github-event", "pull_request")
      .set("x-github-delivery", "delivery-2")
      .set("x-hub-signature-256", signature)
      .send(body);

    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      received: true,
      accepted: true,
      deliveryId: "delivery-2"
    });

    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    expect(mockHandleWebhookEvent).toHaveBeenCalledWith(payload, "delivery-2", "pull_request");
  });
});
