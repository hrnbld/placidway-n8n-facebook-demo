// Offline unit tests for the Code-node logic (no n8n needed):  node tests/run_unit_tests.mjs
// Each src/code/*.js file runs exactly as n8n would run it, with $input / $ / $env stubbed.
import fs from 'fs'; import path from 'path'; import assert from 'assert';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const load = (fn) => fs.readFileSync(path.join(ROOT, 'src/code', fn), 'utf8').replace(/^\/\/@include (\S+)\s*$/gm, (_, f) => fs.readFileSync(path.join(ROOT, 'src/code', f), 'utf8'));
async function runNode(fn, input, refs = {}, env = {}) {
  const $input = { first: () => ({ json: input }), all: () => [{ json: input }] };
  const $ = (n) => ({ first: () => ({ json: refs[n] }), last: () => ({ json: refs[n] }), isExecuted: n in refs });
  const f = new Function('$input', '$', '$env', '$execution', `return (async () => {${load(fn)}})();`);
  return (await f.call({ helpers: {} }, $input, $, env, { id: 't1' }))[0].json;
}
let passed = 0; const ok = (name) => { passed++; console.log('  ok -', name); };
const cfg = { site: { canonicalBase: 'https://www.placidway.com', fetchBase: 'x', userAgent: 'PlacidWayFBDemoBot/1.0', minDelaySeconds: 1.1 },
  imageVariant: 'original', allowPrices: false, maxCharsBeforeLink: 500, candidateWindow: 30, sitemaps: {}, skipUrlPattern: '' };

// 1. robots.txt parsing on the real file
const robots = fs.readFileSync(path.join(ROOT, 'research/robots.txt'), 'utf8');
const plan = { cfg, run: {}, plan: { sitemapPath: '/1/sitemap_articles.xml' }, history: { postedUrls: [], recentCategories: [] } };
const r = await runNode('apply_robots.js', { statusCode: 200, data: robots }, { 'Plan Run (Rotation)': plan });
assert.ok(r.robots.rules.some((x) => x.path === '/admin/' && !x.allow)); assert.equal(r.throttleSeconds, 1.1); ok('real robots.txt parsed, sitemap allowed, throttle 1.1 s');
await assert.rejects(runNode('apply_robots.js', { statusCode: 200, data: robots }, { 'Plan Run (Rotation)': { ...plan, plan: { sitemapPath: '/admin/x.xml' } } }), /ROBOTS_DISALLOWED/); ok('disallowed path refused');
const r2 = await runNode('apply_robots.js', { statusCode: 200, data: 'User-agent: *\nCrawl-delay: 5\nDisallow: /private' }, { 'Plan Run (Rotation)': plan });
assert.equal(r2.throttleSeconds, 5); ok('Crawl-delay honoured');

// 2. sitemap selection on the real 5,000+ entry articles sitemap: dedupe + variety + robots
const sm = fs.readFileSync(path.join(ROOT, 'research/sitemap_articles.xml'), 'utf8');
const st = { ...r, history: { postedUrls: ['https://www.placidway.com/article/9796/Why-Families-Are-Researching-Stem-Cell-Therapy-for-Autism-in-Mexico-What-Evidence-Should-They-Ask-For'], recentCategories: ['cosmetic'] }, plan: { contentType: 'article' } };
const sel = await runNode('select_item.js', { data: sm }, { 'Apply robots.txt': st });
assert.notEqual(sel.item.url, st.history.postedUrls[0]); assert.notEqual(sel.item.category, 'cosmetic'); assert.ok(sel.item.sitemapImage.startsWith('https://placidwaycdn'));
ok(`selected newest unposted, non-repeated category: ${sel.item.url.split('/').slice(4, 6).join('/')} (${sel.item.category}) of ${sel.item.selection.sitemapEntries} entries`);
const sel2 = await runNode('select_item.js', { data: sm }, { 'Apply robots.txt': { ...st, cfg: { ...cfg, skipUrlPattern: 'stem-cell|autism' } } });
assert.ok(!/stem-cell|autism/i.test(sel2.item.url)); ok('SKIP_URL_PATTERN brand-safety filter applied');

// 3. page parsing on all six replay pages (the cut-off must drop related-package prices)
const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/replay/index.json'), 'utf8'));
for (const f of Object.keys(index)) {
  const html = fs.readFileSync(path.join(ROOT, 'fixtures/replay', f.slice(1)), 'utf8');
  const p = await runNode('parse_page.js', { statusCode: 200, headers: {}, data: html }, { 'Select Item': { cfg, item: { url: 'https://www.placidway.com' + f, sitemapImage: '' } } });
  assert.ok(p.page.bodyChars > 2000, f); assert.ok(!p.page.body.includes('Gastric Balloon Surgery Package in Tijuana'), 'related carousel leaked: ' + f); assert.ok(p.page.title.length > 10);
  ok(`parsed ${f.split('/').slice(1, 3).join('/')}: ${p.page.bodyChars} chars, image=${p.page.image ? 'yes' : 'no'}`);
}
await assert.rejects(runNode('parse_page.js', { statusCode: 403, headers: { 'cf-mitigated': 'challenge' }, data: '<title>Just a moment...</title>' }, { 'Select Item': { cfg, item: { url: 'u' } } }), /SOURCE_BLOCKED/); ok('Cloudflare challenge detected');

// 4. guardrail rules
const page = { title: 'Liposuction Package in Cancun', description: '', body: 'Most patients take 1-2 weeks off work to rest and recover. Liposuction can reshape the body but doesn\'t guarantee drastic weight loss. The cost ranges between $5,500 and $7,000.' };
const mk = (lines, evidence, extra = {}) => {
  const draft = { hook: 'Thinking about liposuction in Cancun?', lines, cta: 'Read the full package details:', hashtags: ['#MedicalTourism', '#Cancun', '#Liposuction'], evidence };
  const before = [draft.hook, '', ...lines, '', draft.cta].join('\n');
  return { cfg, page, item: { url: 'https://www.placidway.com/package/7041/x' }, draft, post: { message: `${before}\nhttps://www.placidway.com/package/7041/x\n\n${draft.hashtags.join(' ')}`, beforeLink: before, charsBeforeLink: before.length }, ...extra };
};
let g = await runNode('guardrail_rules.js', mk(['Most patients take 1-2 weeks off work to recover.', 'It reshapes the body; it is not a weight-loss method.'], [{ line: 0, quote: 'Most patients take 1-2 weeks off work to rest and recover.' }, { line: 1, quote: "Liposuction can reshape the body but doesn't guarantee drastic weight loss." }]));
assert.equal(g.rules.pass, true, JSON.stringify(g.rules.issues)); ok('clean grounded draft passes');
g = await runNode('guardrail_rules.js', mk(['Guaranteed results that cure stubborn fat.', 'Only $4,999 with 98% success rate.'], [{ line: 0, quote: 'made up quote that is not there' }]));
const types = g.rules.issues.map((i) => i.type);
assert.ok(types.includes('outcome_promise') && types.includes('medical_claim') && types.includes('invented_price') && types.includes('unsupported_fact'));
ok(`bad draft caught: ${[...new Set(types)].join(', ')} (${g.rules.issues.length} issues)`);
g = await runNode('guardrail_rules.js', mk(['Costs range between $5,500 and $7,000.', 'Most patients take 1-2 weeks off work to recover.'], [{ line: 0, quote: 'The cost ranges between $5,500 and $7,000.' }, { line: 1, quote: 'Most patients take 1-2 weeks off work to rest and recover.' }], { cfg: { ...cfg, allowPrices: true } }));
assert.equal(g.rules.pass, true, JSON.stringify(g.rules.issues)); ok('ALLOW_PRICES=true accepts a price copied verbatim from the source');
g = await runNode('guardrail_rules.js', mk(['x'.repeat(130), 'y'.repeat(130), 'z'.repeat(130), 'w'.repeat(130)], []));
assert.ok(g.rules.issues.some((i) => /before the link/.test(i.reason))); ok('more than 500 chars before the link caught');

// 5. failure classification
for (const [msg, code] of [['400 - {"error":{"message":"Error validating access token","type":"OAuthException","code":190}}', 'FB_TOKEN_EXPIRED'],
  ['503 - Service Unavailable', 'SOURCE_DOWN'], ['getaddrinfo ENOTFOUND www.placidway.com', 'SOURCE_DOWN'],
  ['403 - "<html><title>Just a moment...</title></html>"', 'SOURCE_BLOCKED'], ['LLM_ERROR: openai call failed (HTTP 401)', 'LLM_ERROR'], ['GUARDRAIL_BLOCKED: x', 'GUARDRAIL_BLOCKED'],
  ['GUARDRAIL_BLOCKED: post for https://www.placidway.com/x failed checks after 2 attempt(s): [rules:medical_claim] cures Forbidden claim wording. | [llm:invented_price] $999 Price not in source.', 'GUARDRAIL_BLOCKED']]) {
  const c = await runNode('classify_failure.js', { error: { message: msg } }, {}, {});
  assert.equal(c.code, code, msg); ok(`classified ${code}`);
}
console.log(`\n${passed} checks passed`);
