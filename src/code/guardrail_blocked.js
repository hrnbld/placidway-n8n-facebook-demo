// Guardrail Blocked: no attempt passed, so nothing is published. Hand over to the failure path.
const s = $input.first().json;
const summary = s.guardrail.issues.map((i) => `[${i.by}:${i.type}] ${i.excerpt || ''} ${i.reason}`).join(' | ').slice(0, 900);
return [{ json: { error: { message: `GUARDRAIL_BLOCKED: post for ${s.item.url} failed checks after ${s.attempt} attempt(s): ${summary}` }, blockedDraft: s.post.message } }];
