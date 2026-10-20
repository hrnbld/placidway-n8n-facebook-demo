//@include lib/util.js
// Guardrail 1 - deterministic rules. Cheap, explainable, and impossible to talk around.
const state = $input.first().json;
const { draft, post, page, cfg } = state;
const issues = [];
const add = (type, excerpt, reason) => issues.push({ type, excerpt, reason, by: 'rules' });
const sourceNorm = norm(page.title + ' ' + page.description + ' ' + page.body);
const sourceRaw = page.title + ' ' + page.description + ' ' + page.body;

// Format
if (post.charsBeforeLink > cfg.maxCharsBeforeLink) add('format', '', `Text before the link is ${post.charsBeforeLink} chars (max ${cfg.maxCharsBeforeLink}).`);
if (!draft.hook) add('format', '', 'Missing hook.');
if (draft.lines.length < 2 || draft.lines.length > 4) add('format', '', `Needs 2-4 value lines, got ${draft.lines.length}.`);
if (!draft.cta) add('format', '', 'Missing call to action.');
if (draft.hashtags.length < 3 || draft.hashtags.length > 5) add('format', '', `Needs 3-5 hashtags, got ${draft.hashtags.length}.`);
const urls = post.message.match(/https?:\/\/\S+/g) || [];
if (urls.length !== 1 || urls[0] !== state.item.url) add('format', urls.join(' '), 'Post must contain exactly one URL: the source page.');
const emojis = post.message.match(/\p{Extended_Pictographic}/gu) || [];
if (emojis.length > 2) add('format', emojis.join(''), 'More than 2 emojis.');

// Medical claims / outcome promises (checked on the text the reader sees, hashtags included)
const text = post.beforeLink + ' ' + draft.hashtags.join(' ');
const BANNED = [
  [/\bcur(e|es|ed|ing)\b/i, 'medical_claim'], [/\bheal(s|ed|ing)?\b/i, 'medical_claim'], [/\brevers(e|es|ed|ing)\b/i, 'medical_claim'],
  [/\beliminat(e|es|ed|ing)\b/i, 'medical_claim'], [/\bproven\b|\bclinically proven\b/i, 'medical_claim'], [/\bmiracle\b/i, 'medical_claim'],
  [/\bsafest\b|\b100% safe\b|\bcompletely safe\b|\brisk[- ]free\b|\bno (side effects|risks?)\b/i, 'medical_claim'],
  [/\bpainless\b/i, 'medical_claim'], [/\bbest (doctor|surgeon|clinic|hospital|treatment|results?)\b/i, 'medical_claim'],
  [/\bguarantee(d|s)?\b/i, 'outcome_promise'], [/\bsuccess rate\b/i, 'outcome_promise'], [/\b100\s?%/i, 'outcome_promise'],
  [/\bpermanent(ly)? (results?|fix|solution)\b/i, 'outcome_promise'], [/\bwill (fix|cure|restore|remove|repair|regrow|look)\b/i, 'outcome_promise'],
  [/\blife[- ]changing results\b|\bdramatic results\b/i, 'outcome_promise'],
];
for (const [re, type] of BANNED) { const m = text.match(re); if (m) add(type, m[0], 'Forbidden claim wording.'); }

// Prices: none at all unless ALLOW_PRICES; if allowed, every amount must appear in the source verbatim.
const PRICE = /(?:US\$|\$|€|£|USD|EUR|GBP)\s?\d[\d,.]*(?:\s?(?:k|K))?|\d[\d,.]*\s?(?:USD|EUR|GBP|dollars|euros)\b/g;
for (const m of post.beforeLink.match(PRICE) || []) {
  if (!cfg.allowPrices) add('invented_price', m, 'Prices are disabled (ALLOW_PRICES=false).');
  else if (!sourceRaw.replace(/\s/g, '').includes(m.replace(/\s/g, ''))) add('invented_price', m, 'Price not found verbatim in the source page.');
}
if (!cfg.allowPrices && /\b(cheap|cheapest|affordable|save up to|savings?|discount|cost[s]? less)\b/i.test(post.beforeLink)) {
  const m = post.beforeLink.match(/\b(cheap|cheapest|affordable|save up to|savings?|discount|cost[s]? less)\b/i);
  add('invented_price', m[0], 'Price/saving framing is disabled (ALLOW_PRICES=false).');
}

// Every number in the post must exist in the source (catches invented stats, ages, durations).
const srcNums = new Set((sourceRaw.match(/\d[\d,.]*/g) || []).map((n) => n.replace(/[,.]+$/, '').replace(/,/g, '')));
for (const n of post.beforeLink.match(/\d[\d,.]*/g) || []) {
  const k = n.replace(/[,.]+$/, '').replace(/,/g, '');
  if (k && !srcNums.has(k)) add('unsupported_fact', n, 'Number not found in the source page.');
}

// Grounding: each value line needs a supporting quote that really exists in the source.
draft.lines.forEach((line, i) => {
  const ev = draft.evidence.find((e) => +e.line === i);
  if (!ev || !ev.quote) return add('unsupported_fact', line.slice(0, 80), 'No supporting quote provided for this line.');
  const q = norm(ev.quote);
  if (q.length < 12 || !sourceNorm.includes(q)) add('unsupported_fact', String(ev.quote).slice(0, 80), 'Supporting quote not found in the source page.');
});

return [{ json: { ...state, rules: { pass: issues.length === 0, issues } } }];
