// NEAR AI Cloud layer (T2.5, optional and env-gated).
// The LLM is treated as untrusted input, on par with prompt injection.
// Its output is NEVER signed raw: it is parsed by the deterministic
// parser, then passed through validateBeforeSigning, exactly like the
// parser path. Without a key, the demo runs parser-only and this
// module returns null, which the caller treats as "no LLM intent".

import { parseIntent, type ParseResult } from "./parser.js";

const BASE_URL = "https://cloud-api.near.ai/v1";

export async function getLlmIntent(
  userText: string,
  apiKey: string | undefined,
  model?: string,
): Promise<ParseResult | null> {
  if (!apiKey) return null;
  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model ?? "deepseek-ai/DeepSeek-V3.1",
      messages: [
        {
          role: "system",
          content:
            "You are a payment intent parser. Output ONLY a single line in the exact format: send <amount> NEAR to <account>. Do not add any explanation, punctuation, or extra text.",
        },
        { role: "user", content: userText },
      ],
      temperature: 0,
    }),
  });
  if (!response.ok) {
    return { ok: false, reason: "ParseFailed" };
  }
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content ?? "";
  // Narrow fallback: parse only. If the LLM output is malformed,
  // parseIntent returns ParseFailed and the caller rejects it.
  return parseIntent(content);
}
