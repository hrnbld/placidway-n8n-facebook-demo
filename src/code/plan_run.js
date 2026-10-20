// Plan Run: choose today's content type (weekly rotation) and load what was already posted.
const { cfg, run } = $('Config').first().json;
const rows = $input.all().map((i) => i.json).filter((r) => r && r.url);
const posted = rows.filter((r) => cfg.dedupeDryRun || r.status !== 'dry_run');
posted.sort((a, b) => String(b.posted_at).localeCompare(String(a.posted_at)));

const weekday = new Date().toLocaleDateString('en-US', { weekday: 'short', timeZone: cfg.timezone });
const idx = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(weekday);
let contentType = cfg.contentTypeOverride || cfg.rotation[idx] || 'article';
if (!cfg.sitemaps[contentType]) contentType = 'article';

const sitemapPath = cfg.sitemaps[contentType];
return [{ json: {
  cfg, run,
  plan: { weekday, contentType, sitemapPath, sitemapUrl: cfg.site.canonicalBase + sitemapPath, sitemapFetchUrl: cfg.site.fetchBase + sitemapPath,
          robotsFetchUrl: cfg.site.fetchBase + '/robots.txt' },
  history: {
    postedUrls: posted.map((r) => r.url),
    recentCategories: posted.slice(0, cfg.varietyLookback).map((r) => r.category),
    recentTypes: posted.slice(0, cfg.varietyLookback).map((r) => r.content_type),
  },
} }];
