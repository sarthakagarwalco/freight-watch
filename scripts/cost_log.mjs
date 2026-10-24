import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReasonPrompt, estimateTokens, estimateCostUsd, PRICES } from '../src/llm.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { candidates } = JSON.parse(readFileSync(join(ROOT, 'artifacts', 'results.json'), 'utf8'));

const pct = (v) => (v == null ? 'n/a' : `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(1)}%`);
let inTok = 0, outTok = 0, calls = 0;

for (const c of candidates) {
  const facts = {
    route: c.route,
    week_of: c.week_of,
    verdict: c.verdict,
    matched_note_id: c.matched_note_id,
    vs_own_history: pct(c.own_pct),
    vs_similar_routes: pct(c.peer_pct),
    deterministic_reason: c.reason,
  };
  const { system, user } = buildReasonPrompt(facts);
  inTok += estimateTokens(system) + estimateTokens(user);
  outTok += estimateTokens(c.reason);
  calls += 1;
}

const model = process.env.LLM_MODEL || 'gpt-4o-mini';
const log = {
  default_run: {
    mode: 'deterministic-offline',
    llm_calls: 0,
    input_tokens: 0,
    output_tokens: 0,
    estimated_cost_usd: 0,
  },
  llm_rephrase_estimate: {
    llm_calls: calls,
    input_tokens: inTok,
    output_tokens: outTok,
    model,
    rates_per_1m_usd: PRICES[model] ?? PRICES['gpt-4o-mini'],
    estimated_cost_usd: Number(estimateCostUsd(model, inTok, outTok).toFixed(6)),
  },
};

mkdirSync(join(ROOT, 'artifacts'), { recursive: true });
writeFileSync(join(ROOT, 'artifacts', 'cost_log.json'), JSON.stringify(log, null, 2));
console.log('Saved cost estimate to artifacts/cost_log.json');
