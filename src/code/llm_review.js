//@include lib/util.js
//@include lib/llm.js
//@include lib/prompts.js
// Guardrail 2 - an independent LLM pass (temperature 0) that reads the source and the post like a compliance reviewer.
const state = $input.first().json;
const llm = { ...state.cfg.llm, apiKey: $env.LLM_API_KEY, temperature: 0, model: state.cfg.llm.reviewModel || state.cfg.llm.model };
const user = `ALLOW_PRICES: ${state.cfg.allowPrices}
${sourceBlock(state.item, state.page, state.cfg)}

<<<POST
${state.post.message}
POST>>>`;
const out = await callLLM(this, llm, REVIEWER_SYSTEM, user);
const issues = (Array.isArray(out.data.issues) ? out.data.issues : []).map((i) => ({ type: String(i.type || 'issue'), excerpt: String(i.excerpt || ''), reason: String(i.reason || ''), by: 'llm' }));
const review = { pass: out.data.pass === true && issues.length === 0, issues };
return [{ json: { ...state, review } }];
