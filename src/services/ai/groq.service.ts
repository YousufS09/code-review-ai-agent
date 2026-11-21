import { env } from "../../config/env";
import { HttpError } from "../../utils/http-error.util";
import { fetchWithRetry } from "../../utils/http.util";
import { truncateText } from "../../utils/text.util";

interface GroqMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface GroqChatCompletionResponse {
  choices: Array<{
    message: {
      content: string | null;
    };
  }>;
}

export class GroqService {
  async reviewCode(systemPrompt: string, userPrompt: string): Promise<string> {
    const response = await fetchWithRetry(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: env.GROQ_MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ] satisfies GroqMessage[],
          temperature: env.GROQ_TEMPERATURE,
          response_format: { type: "json_object" }
        })
      },
      // A chat completion has no side effects, so timeouts and 5xx responses are safe to retry.
      { timeoutMs: env.GROQ_TIMEOUT_MS, retries: 2, retryUnsafe: true }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new HttpError(response.status, `Groq API request failed: ${truncateText(errorBody, 500)}`, false);
    }

    const data = (await response.json()) as GroqChatCompletionResponse;
    const content = data.choices[0]?.message.content;

    if (!content) {
      throw new HttpError(500, "Groq returned an empty response", false);
    }

    return content;
  }
}
