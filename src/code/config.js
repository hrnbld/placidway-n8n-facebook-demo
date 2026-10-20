// Config: every setting comes from environment variables, with safe defaults (dry run ON, approval OFF).
const env = (k, d = '') => ($env[k] === undefined || $env[k] === null || $env[k] === '' ? d : String($env[k]));
const bool = (k, d) => /^(1|true|yes|on)$/i.test(env(k, d ? 'true' : 'false'));
const num = (k, d) => (isNaN(parseFloat(env(k, ''))) ? d : parseFloat(env(k, '')));

let trigger = 'manual';
try { if ($('Run Now (Webhook)').isExecuted) trigger = 'webhook'; } catch (e) {}
try { if ($('Daily Schedule').isExecuted) trigger = 'schedule'; } catch (e) {}

// Optional shared secret for the webhook trigger
const hook = trigger === 'webhook' ? $('Run Now (Webhook)').first().json : {};
if (trigger === 'webhook' && env('RUN_TOKEN')) {
  const got = hook.headers?.['x-run-token'] || hook.query?.token;
  if (got !== env('RUN_TOKEN')) throw new Error('CONFIG_ERROR: invalid or missing run token');
}
const webhookOverrides = hook.query || {};

const provider = env('LLM_PROVIDER', 'openai').toLowerCase();
const cfg = {
  dryRun: bool('DRY_RUN', true),
  approvalMode: webhookOverrides.approval !== undefined ? /^(1|true|yes|on)$/i.test(String(webhookOverrides.approval)) : bool('APPROVAL_MODE', false),
  timezone: env('GENERIC_TIMEZONE', 'Asia/Jakarta'),
  site: {
    canonicalBase: 'https://www.placidway.com',
    fetchBase: env('PW_BASE_URL', 'https://www.placidway.com').replace(/\/$/, ''),
    userAgent: env('PW_USER_AGENT', 'PlacidWayFBDemoBot/1.0 (+assessment demo; contact hello@herin.id)'),
    minDelaySeconds: Math.max(1, num('PW_MIN_DELAY_SECONDS', 1.1)),
  },
  sitemaps: {
    article: '/1/sitemap_articles.xml',
    package: '/1/sitemap_packages.xml',
    answer: '/sitemap/1/sitemap_answers.xml',
  },
  rotation: env('CONTENT_ROTATION', 'article,package,answer,article,package,answer,article').split(',').map((s) => s.trim()), // Mon..Sun
  contentTypeOverride: webhookOverrides.type || env('CONTENT_TYPE_OVERRIDE', ''),
  candidateWindow: num('CANDIDATE_WINDOW', 30),
  skipUrlPattern: env('SKIP_URL_PATTERN', ''), // optional brand-safety regex, e.g. autism|terminal
  varietyLookback: num('VARIETY_LOOKBACK', 3),
  dedupeDryRun: bool('DEDUPE_INCLUDE_DRY_RUN', true),
  sourceMaxChars: num('SOURCE_MAX_CHARS', 9000),
  imageVariant: webhookOverrides.image || env('IMAGE_VARIANT', 'original'), // original = raw CDN file, og = PlacidWay's 1200x630 social crop, none = link post
  allowPrices: bool('ALLOW_PRICES', false),
  maxRewrites: num('MAX_REWRITES', 1),
  maxCharsBeforeLink: num('MAX_CHARS_BEFORE_LINK', 500),
  llm: {
    provider: provider === 'anthropic' ? 'anthropic' : 'openai',
    baseUrl: env('LLM_BASE_URL', provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'),
    model: env('LLM_MODEL', provider === 'anthropic' ? 'claude-sonnet-4-5' : 'gpt-4o-mini'),
    reviewModel: env('LLM_REVIEW_MODEL', ''),
    apiKey: env('LLM_API_KEY', ''),
    temperature: num('LLM_TEMPERATURE', 0.4),
    jsonMode: bool('LLM_JSON_MODE', true),
    maxTries: num('LLM_MAX_TRIES', 3),
    timeoutMs: num('LLM_TIMEOUT_MS', 60000),
  },
  fb: {
    graphBase: env('FB_GRAPH_BASE_URL', 'https://graph.facebook.com').replace(/\/$/, ''),
    version: env('FB_GRAPH_VERSION', 'v24.0'),
    pageId: env('FB_PAGE_ID', ''),
    pageName: env('FB_PAGE_NAME', 'NeuPix'),
    allowedPageIds: env('FB_ALLOWED_PAGE_IDS', env('FB_PAGE_ID', '')).split(',').map((s) => s.trim()).filter(Boolean),
    scheduleDelayMinutes: webhookOverrides.schedule !== undefined ? +webhookOverrides.schedule || 0 : num('FB_SCHEDULE_DELAY_MINUTES', 0),
    hasToken: !!env('FB_PAGE_TOKEN', ''),
  },
  review: { webhookUrl: env('REVIEW_WEBHOOK_URL', env('ALERT_WEBHOOK_URL', '')), format: env('WEBHOOK_FORMAT', 'slack') },
  alert: { webhookUrl: env('ALERT_WEBHOOK_URL', ''), format: env('WEBHOOK_FORMAT', 'slack') },
};
if (cfg.llm.apiKey) cfg.llm.apiKeySet = true;

// Safety checks before doing any work
const problems = [];
if (!cfg.dryRun) {
  if (!cfg.fb.pageId) problems.push('FB_PAGE_ID is required when DRY_RUN=false');
  if (!cfg.fb.hasToken) problems.push('FB_PAGE_TOKEN is required when DRY_RUN=false');
  if (cfg.fb.pageId && !cfg.fb.allowedPageIds.includes(cfg.fb.pageId)) problems.push('FB_PAGE_ID is not in FB_ALLOWED_PAGE_IDS (publishing is restricted to your own test page)');
}
if (!cfg.llm.apiKey) problems.push('LLM_API_KEY is not set');
if (problems.length) throw new Error('CONFIG_ERROR: ' + problems.join('; '));

const run = { id: String($execution.id), trigger, startedAt: new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC', mode: (cfg.dryRun ? 'dry_run' : 'live') + (cfg.approvalMode ? '+approval' : '+auto') };
// Never carry the API key forward in item data (execution logs) - nodes read it from $env when needed.
delete cfg.llm.apiKey;
return [{ json: { cfg, run } }];
