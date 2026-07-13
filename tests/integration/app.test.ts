jest.mock("../../src/services/review/review.service", () => {
  return {
    ReviewService: jest.fn().mockImplementation(() => ({
      handleWebhookEvent: jest.fn()
    }))
  };
});

import request from "supertest";
import { app } from "../../src/app";

describe("app", () => {
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
});

