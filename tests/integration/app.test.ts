import crypto from "node:crypto";

const mockEnqueueReview = jest.fn().mockResolvedValue(undefined);

jest.mock("../../src/config/queue", () => {
  return {
    enqueueReview: mockEnqueueReview
  };
});

import request from "supertest";
import { app } from "../../src/app";

describe("app", () => {
  beforeEach(() => {
    mockEnqueueReview.mockReset();
    mockEnqueueReview.mockResolvedValue(undefined);
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

  it("enqueues a valid pull request webhook before acknowledging it", async () => {
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
    expect(mockEnqueueReview).toHaveBeenCalledWith({
      payload,
      deliveryId: "delivery-2",
      eventType: "pull_request"
    });
  });

  it("does not expose readiness failure details", async () => {
    const { prisma } = await import("../../src/config/database");
    const querySpy = jest.spyOn(prisma, "$queryRaw").mockRejectedValueOnce(new Error("connect ECONNREFUSED db.internal:5432"));
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await request(app).get("/ready");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: "not ready" });
    querySpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("returns an error instead of acknowledging when the job cannot be enqueued", async () => {
    mockEnqueueReview.mockRejectedValueOnce(new Error("database unavailable"));

    const body = JSON.stringify({
      action: "opened",
      installation: { id: 1 },
      repository: { name: "demo", owner: { login: "octocat" } },
      pull_request: { number: 1, head: { sha: "abc123" } },
      sender: { login: "octocat" }
    });
    const signature = `sha256=${crypto.createHmac("sha256", "test-webhook-secret").update(body).digest("hex")}`;

    const response = await request(app)
      .post("/webhooks/github")
      .set("content-type", "application/json")
      .set("x-github-event", "pull_request")
      .set("x-github-delivery", "delivery-3")
      .set("x-hub-signature-256", signature)
      .send(body);

    expect(response.status).toBe(500);
  });
});
