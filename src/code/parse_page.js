//@include lib/util.js
// Parse Page: detect bot walls, then extract title, summary, featured image and the main body text.
const state = $('Select Item').first().json;
const res = $input.first().json;
const html = String(res.data ?? res.body ?? '');
const status = res.statusCode || 200;
const headers = res.headers || {};
if (headers['cf-mitigated'] || /<title>\s*Just a moment|challenge-platform|cf-chl-/i.test(html)) {
  throw new Error(`SOURCE_BLOCKED: Cloudflare challenge on ${state.item.url} (HTTP ${status}). The host IP is being challenged; run from a different network or ask PlacidWay to allow-list the bot.`);
}
if (status >= 400) throw new Error(`SOURCE_DOWN: ${state.item.url} returned HTTP ${status}`);

const meta = (key) => {
  const a = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`, 'i'));
  const b = html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`, 'i'));
  return decodeEntities((a || b || [])[1] || '').trim();
};
const strip = (s) => decodeEntities(String(s).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const h1 = strip((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '');
const docTitle = strip((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
const canonical = (html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i) || [])[1] || state.item.url;

// Main content = everything after the H1, cut at the first block that is not part of the page body
// (disclaimer, references, quote form, related listings, footer). Related listings carry other prices,
// so cutting them out is part of the "no invented prices" guardrail.
let main = html;
const h1Pos = html.search(/<\/h1>/i);
if (h1Pos > -1) main = html.slice(h1Pos + 5);
// Drop share/quote popups first: on live pages they sit right after the H1 and would end the body early.
main = main.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<[^>]*>/g, (t) => t.replace(/\s+/g, ' ')); // multi-line tags would leak into the text once split by line
const STOP = /<(h[1-6]|div|section|p|strong|span)[^>]*>\s*(Medical Disclaimer|References|Request your Free Quote|About Article|Trusted Medical Tourism Platform|Unlock the Best|Related (Articles|Packages)|Share this listing)\b/gi;
// Cut at the first stop marker that comes after real content (>= 600 chars of text), skipping early popups.
for (const m of main.matchAll(STOP)) {
  if (strip(main.slice(0, m.index)).length >= 600) { main = main.slice(0, m.index); break; }
}
main = main
  .replace(/<(script|style|noscript|svg|form|nav|footer|header|iframe)[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<\/(td|th)>/gi, ' | ')
  .replace(/<(br|\/p|\/h[1-6]|\/li|\/tr|\/div|\/table|\/ul|\/ol)[^>]*>/gi, '\n')
  .replace(/<li[^>]*>/gi, '\n- ');
const body = main.split('\n')
  .map((l) => strip(l).replace(/\s*\|\s*$/, ''))
  .filter((l) => l && l !== '-' && !/^(copy link|share this|https?:\/\/\S+)$/i.test(l))
  .join('\n')
  .slice(0, 20000);
if (body.length < 400) throw new Error(`PARSE_FAILED: main content too short (${body.length} chars) on ${state.item.url} - page layout may have changed`);

// Featured image: og:image, else the sitemap <image:loc>, else first content image.
let image = meta('og:image') || state.item.sitemapImage || ((main.match(/<img[^>]+src=["'](https:[^"']+)["']/i) || [])[1] || '');
if (state.cfg.imageVariant === 'original') {
  const m = image.match(/\/cdn-cgi\/image\/[^/]+\/(https?:\/\/.+)$/); // unwrap PlacidWay's CDN resizer to the original file
  if (m) image = m[1];
}
if (state.cfg.imageVariant === 'none') image = ''; // forces a text+link post (/feed)
const description = meta('og:description') || meta('description') || body.split('\n').find((l) => l.length > 80)?.slice(0, 300) || '';
const page = { title: h1 || meta('og:title') || docTitle, metaTitle: meta('og:title') || docTitle, description, image, canonical, body, bodyChars: body.length };
return [{ json: { ...state, page, attempt: 0, guardrailHistory: [] } }];
