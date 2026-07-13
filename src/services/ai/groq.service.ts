import { env } from "../../config/env";
import { HttpError } from "../../utils/http-error.util";

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
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
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
        temperature: 0.2,
        response_format: { type: "json_object" }
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new HttpError(response.status, `Groq API request failed: ${errorBody}`, false);
    }

    const data = (await response.json()) as GroqChatCompletionResponse;
    const content = data.choices[0]?.message.content;

    if (!content) {
      throw new HttpError(500, "Groq returned an empty response");
    }

    return content;
  }
}

