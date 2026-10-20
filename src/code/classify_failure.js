// Classify Failure: every error branch lands here. Turn raw errors into an actionable alert + a failed run row.
const input = $input.first().json;
const raw = input.error?.message || input.error?.description || (typeof input.error === 'string' ? input.error : '') || input.message || JSON.stringify(input).slice(0, 500);
const desc = String(input.error?.description || '');
let msg = String(raw) + (desc && !String(raw).includes(desc) ? ' | ' + desc : '');
const cfChallenge = /Just a moment|cf-mitigated|challenge-platform/i.test(msg);
msg = msg.replace(/<[^>]*>/g, ' ').replace(/\\"/g, '"').replace(/\s+/g, ' ').trim().slice(0, 600); // strip HTML error pages
if (cfChallenge) msg = 'SOURCE_BLOCKED: Cloudflare "Just a moment" challenge (HTTP 403). ' + msg.slice(0, 120);
// Explicit codes thrown by our own nodes are matched first, so words inside their messages
// (e.g. a guardrail issue saying "Forbidden claim wording") can't be mistaken for an HTTP 403 or a token error.
const rules = [
  ['ROBOTS_DISALLOWED', /ROBOTS_DISALLOWED/, 'robots.txt now disallows the content we read. Workflow refused to fetch it.'],
  ['NO_NEW_CONTENT', /NO_NEW_CONTENT/, 'Every recent item of today\'s content type was already posted. Consider widening CANDIDATE_WINDOW.'],
  ['PARSE_FAILED', /PARSE_FAILED/, 'The page layout may have changed; check the Parse Page node.'],
  ['GUARDRAIL_BLOCKED', /GUARDRAIL_BLOCKED/, 'Draft failed the safety checks twice, so nothing was published. Review the issues below.'],
  ['CONFIG_ERROR', /CONFIG_ERROR/, 'Fix the environment variables listed in the message.'],
  ['FB_TOKEN_EXPIRED', /\b190\b|OAuthException|access token|Session has expired/i, 'Facebook page token is invalid or expired. Generate a new long-lived Page token (README section 5) and update FB_PAGE_TOKEN.'],
  ['FB_PERMISSION', /\(#(10|200|210)\)|pages_manage_posts|permission/i, 'The token lacks pages_manage_posts / pages_read_engagement for this Page.'],
  ['SOURCE_BLOCKED', /SOURCE_BLOCKED|cf-mitigated|Just a moment|\b403\b|Forbidden/i, 'placidway.com refused the request (bot wall). Nothing was posted. Retry later or from another network.'],
  ['SOURCE_DOWN', /SOURCE_DOWN|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|socket hang up|timeout|\b50[0-4]\b|Service Unavailable|Bad gateway/i, 'placidway.com is unreachable or erroring. Retries were exhausted; tomorrow\'s run will try again.'],
  ['LLM_ERROR', /LLM_|openai|anthropic/i, 'The LLM call failed (key, quota or provider outage).'],
];
// Publish failures get their own rules: a Facebook error must never read as a PlacidWay outage,
// and a timeout after the POST left may mean the post is already live.
let publishNode = '';
for (const n of ['Facebook: Publish Photo', 'Facebook: Publish Link Post']) {
  try { if ($(n).isExecuted) publishNode = n; } catch (e) {}
}
const fbRules = [
  ['FB_TOKEN_EXPIRED', /"code"\s*:\s*190\b|\(#190\)|\bcode 190\b|Session has expired|Error validating access token/i, 'Facebook page token is invalid or expired. Generate a new long-lived Page token (README section 5) and update FB_PAGE_TOKEN. Nothing was posted.'],
  ['FB_PERMISSION', /"code"\s*:\s*(10|200|210)\b|\(#(10|200|210)\)|pages_manage_posts|permission/i, 'The token lacks pages_manage_posts / pages_read_engagement for this Page. Nothing was posted.'],
  ['FB_PUBLISH_UNCERTAIN', /ETIMEDOUT|ECONNRESET|ECONNABORTED|socket hang up|timeout|timed out/i, 'The request to Facebook timed out, so the post MAY already be live. Check the Page before re-running; if it is live, do not re-run (the URL is not marked as posted).'],
  ['FB_TEMPORARY', /.*/, 'Facebook returned a temporary or unknown error and did not confirm the post. Check the Page once, then re-run manually or let tomorrow\'s run retry.'],
];
const [code, , hint] = (publishNode ? fbRules : rules).find(([, re]) => re.test(msg)) || ['UNEXPECTED', null, 'Unexpected error - open the execution in n8n.'];
// Recover as much run context as exists (the furthest successful step wins).
let ctx = {};
for (const n of ['Final Post', 'Parse Page', 'Select Item', 'Apply robots.txt', 'Plan Run (Rotation)', 'Config']) {
  try { const j = $(n).first(0)?.json; if (j && j.run) { ctx = j; break; } } catch (e) {} // output 0 = success branch (default would follow our error branch)
}
let failedNode = '';
for (const n of ['Fetch robots.txt', 'Fetch Sitemap', 'Fetch Page', 'Parse Page', 'LLM: Write Post', 'Guardrail 2: LLM Review', 'Facebook: Publish Photo', 'Facebook: Publish Link Post', 'Select Item', 'Apply robots.txt', 'Config']) {
  try { if ($(n).isExecuted) failedNode = n; } catch (e) {}
}
const run = ctx.run || { id: String($execution.id), trigger: 'unknown', startedAt: new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC', mode: '' };
const status = code === 'GUARDRAIL_BLOCKED' ? 'guardrail_blocked' : code === 'NO_NEW_CONTENT' ? 'skipped' : code === 'FB_PUBLISH_UNCERTAIN' ? 'publish_uncertain' : 'failed';
const row = {
  run_id: run.id, started_at: run.startedAt, finished_at: new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC', trigger: run.trigger, mode: run.mode,
  content_type: ctx.item?.contentType || ctx.plan?.contentType || '', category: ctx.item?.category || '', item_url: ctx.item?.url || '',
  item_title: '', image_url: '', post_text: input.blockedDraft || '', chars_before_link: 0, attempts: 0, guardrail: '',
  fb_post_id: '', status, error: `${code}: ${msg}`.slice(0, 1500), review_url: '',
};
const text = `:rotating_light: *PlacidWay -> Facebook run ${status.toUpperCase()}* - ${code}\nRun: ${run.id} (${run.trigger}, ${run.mode})\nItem: ${row.item_url || 'n/a'}\nWhat happened: ${msg.slice(0, 700)}\nWhat to do: ${hint}`;
const fmt = $env.WEBHOOK_FORMAT || 'slack';
const alert = { url: $env.ALERT_WEBHOOK_URL || '', payload: fmt === 'slack' ? { text } : { event: 'run_failed', code, status, run_id: run.id, item_url: row.item_url, message: msg, hint } };
return [{ json: { row, alert, code, hint, message: msg, failedNodeHint: publishNode || failedNode } }];
