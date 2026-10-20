// ---- provider-agnostic LLM adapter (OpenAI-compatible or Anthropic) ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function parseJsonLoose(text) {
  let t = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a === -1 || b === -1) throw new Error('LLM_BAD_OUTPUT: no JSON object in model response');
  return JSON.parse(t.slice(a, b + 1));
}
async function callLLM(ctx, llm, system, user) {
  if (!llm.apiKey) throw new Error('LLM_CONFIG: LLM_API_KEY is not set');
  const base = llm.baseUrl.replace(/\/$/, '');
  let req;
  if (llm.provider === 'anthropic') {
    req = { method: 'POST', url: base + '/v1/messages', json: true, timeout: llm.timeoutMs,
      headers: { 'x-api-key': llm.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: { model: llm.model, max_tokens: 1000, temperature: llm.temperature, system, messages: [{ role: 'user', content: user }] } };
  } else {
    const body = { model: llm.model, temperature: llm.temperature, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
    if (llm.jsonMode) body.response_format = { type: 'json_object' };
    req = { method: 'POST', url: base + '/chat/completions', json: true, timeout: llm.timeoutMs,
      headers: { Authorization: 'Bearer ' + llm.apiKey, 'content-type': 'application/json' }, body };
  }
  let lastErr;
  for (let attempt = 1; attempt <= llm.maxTries; attempt++) {
    try {
      const res = await ctx.helpers.httpRequest(req);
      const text = llm.provider === 'anthropic'
        ? (res.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('')
        : res.choices?.[0]?.message?.content;
      return { data: parseJsonLoose(text), raw: text, attempts: attempt };
    } catch (e) {
      lastErr = e;
      const m = String(e.message || e);
      const status = e.httpCode || e.statusCode || e.response?.status || +((m.match(/status code (\d{3})/) || [])[1] || 0);
      const retryable = !status || status === 429 || status >= 500 || /LLM_BAD_OUTPUT|Unexpected token|JSON/.test(m);
      if (!retryable || attempt === llm.maxTries) {
        throw new Error(`LLM_ERROR: ${llm.provider} call failed after ${attempt} attempt(s)` + (status ? ` (HTTP ${status})` : '') + `: ${m.slice(0, 300)}`);
      }
      await sleep(2000 * Math.pow(3, attempt - 1)); // 2s, 6s
    }
  }
  throw lastErr;
}
