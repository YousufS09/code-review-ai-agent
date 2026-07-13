import { z } from "zod";
import type { ReviewAnalysis } from "../../types/review.types";
import { stripCodeFences } from "../../utils/text.util";
import { HttpError } from "../../utils/http-error.util";

const ReviewFindingSchema = z.object({
  file: z.string().min(1),
  line: z.coerce.number().int().nonnegative().nullable().optional().transform((value) => value ?? null),
  severity: z.enum(["critical", "high", "medium", "low"]),
  issue: z.string().min(1),
  explanation: z.string().min(1),
  suggestedFix: z.string().min(1)
});

const ReviewAnalysisSchema = z.object({
  summary: z.string().min(1),
  findings: z.array(ReviewFindingSchema)
});

export class ResponseParserService {
  parse(rawResponse: string): ReviewAnalysis {
    const cleaned = stripCodeFences(rawResponse);

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new HttpError(500, "Groq response was not valid JSON");
    }

    const result = ReviewAnalysisSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
      throw new HttpError(500, `Groq JSON did not match the expected schema: ${issues}`);
    }

    return result.data;
  }
}
