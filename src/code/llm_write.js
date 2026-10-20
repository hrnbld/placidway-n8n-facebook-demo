//@include lib/util.js
//@include lib/llm.js
//@include lib/prompts.js
// LLM: Write Post (first draft or rewrite). Provider is chosen by LLM_PROVIDER.
const state = $input.first().json;
const llm = { ...state.cfg.llm, apiKey: $env.LLM_API_KEY };
let user = `Write one Facebook post for the page "${state.cfg.fb.pageName}" that shares this PlacidWay ${state.item.contentType === 'answer' ? 'patient Q&A answer' : state.item.contentType}.
ALLOW_PRICES: ${state.cfg.allowPrices}
${sourceBlock(state.item, state.page, state.cfg)}`;
if (state.rewrite) {
  user += `

PREVIOUS ATTEMPT FAILED these checks - fix every one of them:
${state.rewrite.issues.map((i) => `- [${i.type}] ${i.excerpt ? '"' + i.excerpt + '" - ' : ''}${i.reason}`).join('\n')}
Previous draft: ${JSON.stringify(state.rewrite.previous)}`;
}
const out = await callLLM(this, llm, WRITER_SYSTEM, user);
const d = out.data || {};
const draft = {
  hook: String(d.hook || '').trim(),
  lines: (Array.isArray(d.lines) ? d.lines : []).map((s) => String(s).trim()).filter(Boolean),
  cta: String(d.cta || '').trim(),
  hashtags: (Array.isArray(d.hashtags) ? d.hashtags : []).map((h) => '#' + String(h).replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '')).filter((h) => h.length > 1),
  evidence: Array.isArray(d.evidence) ? d.evidence : [],
};
const link = state.item.url;
const before = [draft.hook, '', ...draft.lines, '', draft.cta].join('\n').trim();
const message = `${before}\n${link}\n\n${draft.hashtags.join(' ')}`;
const attempt = (state.attempt || 0) + 1;
return [{ json: { ...state, attempt, draft, post: { message, beforeLink: before, charsBeforeLink: [...before].length, link }, llmAttempts: out.attempts } }];
