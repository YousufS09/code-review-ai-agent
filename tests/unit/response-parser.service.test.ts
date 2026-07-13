import { ResponseParserService } from "../../src/services/ai/response-parser.service";

describe("ResponseParserService", () => {
  it("parses a valid analysis payload", () => {
    const service = new ResponseParserService();
    const result = service.parse(
      JSON.stringify({
        summary: "No major issues were detected.",
        findings: []
      })
    );

    expect(result.summary).toContain("No major issues");
    expect(result.findings).toHaveLength(0);
  });

  it("rejects invalid JSON", () => {
    const service = new ResponseParserService();

    expect(() => service.parse("not json")).toThrow("Groq response was not valid JSON");
  });
});

