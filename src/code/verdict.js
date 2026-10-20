// Guardrail Verdict: publish only if BOTH the rules and the LLM reviewer pass.
const state = $input.first().json;
const issues = [...state.rules.issues, ...state.review.issues];
const pass = state.rules.pass && state.review.pass;
const guardrailHistory = [...(state.guardrailHistory || []), { attempt: state.attempt, rulesPass: state.rules.pass, llmPass: state.review.pass, issues, draft: state.post.message }];
return [{ json: { ...state, guardrail: { pass, issues, attempt: state.attempt }, guardrailHistory, canRewrite: !pass && state.attempt <= state.cfg.maxRewrites } }];
