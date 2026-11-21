import { fetchWithRetry } from "../../src/utils/http.util";

function respond(status: number, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : "body", { status, headers });
}

describe("fetchWithRetry", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("retries 5xx responses for safe requests and returns the first success", async () => {
    fetchMock.mockResolvedValueOnce(respond(503)).mockResolvedValueOnce(respond(200));

    const response = await fetchWithRetry("https://x", {}, { timeoutMs: 1000, baseDelayMs: 1 });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("honours Retry-After on 429 even for unsafe requests", async () => {
    fetchMock.mockResolvedValueOnce(respond(429, { "retry-after": "0" })).mockResolvedValueOnce(respond(201));

    const response = await fetchWithRetry("https://x", { method: "POST" }, { timeoutMs: 1000, retryUnsafe: false });

    expect(response.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry 5xx or network errors for unsafe requests", async () => {
    fetchMock.mockResolvedValueOnce(respond(502));
    const response = await fetchWithRetry("https://x", { method: "POST" }, { timeoutMs: 1000, retryUnsafe: false, baseDelayMs: 1 });
    expect(response.status).toBe(502);

    fetchMock.mockRejectedValueOnce(new Error("socket hang up"));
    await expect(
      fetchWithRetry("https://x", { method: "POST" }, { timeoutMs: 1000, retryUnsafe: false, baseDelayMs: 1 })
    ).rejects.toThrow("socket hang up");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after the retry limit and returns the last response", async () => {
    fetchMock.mockResolvedValue(respond(500));

    const response = await fetchWithRetry("https://x", {}, { timeoutMs: 1000, retries: 2, baseDelayMs: 1 });

    expect(response.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("passes a timeout signal to fetch", async () => {
    fetchMock.mockResolvedValueOnce(respond(200));

    await fetchWithRetry("https://x", {}, { timeoutMs: 1000 });

    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});
