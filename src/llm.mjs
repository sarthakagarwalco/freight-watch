export const PRICES = {
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4o': { input: 2.50, output: 10.00 },
  'llama-3.1-8b-instant': { input: 0.05, output: 0.08 },
};

// Rough token count (~4 chars/token)
export function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text).length / 4));
}

export function buildReasonPrompt(facts) {
  const system =
    'You rewrite a logistics analyst note in one or two plain-English sentences. ' +
    'Do not change, add, or drop any fact, number, date, route, note id, or ' +
    'verdict. Output only the rewritten sentence(s).';
  const user = JSON.stringify({
    route: facts.route,
    week_of: facts.week_of,
    verdict: facts.verdict,
    matched_note_id: facts.matched_note_id || null,
    vs_own_history: facts.vs_own_history,
    vs_similar_routes: facts.vs_similar_routes,
    grounded_reason: facts.deterministic_reason,
  });
  return { system, user };
}

export function llmEnabled() {
  return Boolean(process.env.LLM_API_KEY || process.env.OPENAI_API_KEY);
}

export async function callLLM(facts) {
  const key = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
  if (!key) throw new Error('No LLM API key configured');
  const base = process.env.LLM_BASE_URL || 'https://api.openai.com/v1';
  const model = process.env.LLM_MODEL || 'gpt-4o-mini';
  const { system, user } = buildReasonPrompt(facts);

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
  const json = await res.json();
  const text = json.choices?.[0]?.message?.content ?? '';
  const usage = {
    input_tokens: json.usage?.prompt_tokens ?? estimateTokens(system + user),
    output_tokens: json.usage?.completion_tokens ?? estimateTokens(text),
  };
  return { text, usage };
}

export function estimateCostUsd(model, inputTokens, outputTokens) {
  const p = PRICES[model] ?? PRICES['gpt-4o-mini'];
  return (inputTokens / 1e6) * p.input + (outputTokens / 1e6) * p.output;
}
