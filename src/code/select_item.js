// Select Item: parse the sitemap, drop anything disallowed or already posted, prefer the newest
// item whose treatment category differs from the last few posts (variety rule).
const state = $('Apply robots.txt').first().json;
const xml = String($input.first().json.data ?? $input.first().json.body ?? '');
if (!/<urlset/i.test(xml)) throw new Error('PARSE_FAILED: sitemap response is not a <urlset> document' + (/just a moment|cf-mitigated|challenge/i.test(xml) ? ' (looks like a Cloudflare challenge page)' : ''));

function isAllowed(path, rules) {
  let best = null;
  for (const r of rules) {
    const re = new RegExp('^' + r.path.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
    if (re.test(path) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return !best || best.allow;
}
const CATEGORIES = [
  ['cardiac', /cardiac|heart|cabg|coronary|valve|angioplasty/],
  ['cancer', /cancer|oncolog|tumou?r|lymphoma|leukemia|carcinoma|melanoma/],
  ['neuro', /huntington|parkinson|alzheimer|autism|stroke|multiple-sclerosis|\bms\b|neuro|\bals\b|cerebral/],
  ['stem-cell', /stem-?cell|regenerative|\bprp\b|exosome|cellular/],
  ['cosmetic', /liposuction|tummy|abdominoplasty|plastic|cosmetic|breast|rhinoplasty|facelift|\bbbl\b|body-contour|eyelid|mommy/],
  ['bariatric', /bariatric|gastric|weight-loss|sleeve|obesity|ozempic|mounjaro|glp/],
  ['dental', /dental|implant|veneer|teeth|tooth|crown|all-on/],
  ['orthopedic', /knee|hip|spine|orthop|joint|shoulder|arthritis/],
  ['fertility', /ivf|fertility|surrogacy|egg-freez|infertility/],
  ['hair', /hair/], ['eye', /lasik|eye|cataract|vision/],
];
const categoryOf = (url) => { const s = url.toLowerCase(); for (const [c, re] of CATEGORIES) if (re.test(s)) return c; return 'other'; };

const entries = [];
for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
  const block = m[1];
  const loc = (block.match(/<loc>\s*([^<\s]+)\s*<\/loc>/) || [])[1];
  if (!loc) continue;
  const lastmod = (block.match(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/) || [])[1] || '';
  const image = (block.match(/<image:loc>\s*([^<\s]+)\s*<\/image:loc>/) || [])[1] || '';
  const id = +((loc.match(/\/(\d+)\//) || [])[1] || 0);
  entries.push({ url: loc.replace(/&amp;/g, '&'), lastmod, sitemapImage: image.replace(/&amp;/g, '&'), id });
}
const posted = new Set(state.history.postedUrls);
const base = state.cfg.site.canonicalBase;
const fresh = entries
  .filter((e) => e.url.startsWith(base + '/'))
  .filter((e) => isAllowed(e.url.slice(base.length), state.robots.rules))
  .filter((e) => !posted.has(e.url))
  .filter((e) => !state.cfg.skipUrlPattern || !new RegExp(state.cfg.skipUrlPattern, 'i').test(e.url))
  .sort((a, b) => b.lastmod.localeCompare(a.lastmod) || b.id - a.id)
  .slice(0, state.cfg.candidateWindow)
  .map((e) => ({ ...e, category: categoryOf(e.url) }));
if (!fresh.length) throw new Error(`NO_NEW_CONTENT: all ${entries.length} '${state.plan.contentType}' sitemap items are already posted or disallowed`);

const recent = new Set(state.history.recentCategories);
const pick = fresh.find((e) => !recent.has(e.category)) || fresh[0];
const item = { ...pick, contentType: state.plan.contentType, fetchUrl: state.cfg.site.fetchBase + pick.url.slice(base.length),
  selection: { sitemapEntries: entries.length, candidates: fresh.length, varietySkipped: fresh.indexOf(pick), avoidedCategories: [...recent] } };
return [{ json: { ...state, item } }];
