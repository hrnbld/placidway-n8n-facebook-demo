// Apply robots.txt: parse the rules for our user agent (falls back to '*'), honour Crawl-delay,
// and refuse to continue if the sitemap itself is disallowed.
const state = $('Plan Run (Rotation)').first().json;
const res = $input.first().json;
const text = String(res.data ?? res.body ?? '');
if ((res.statusCode || 200) >= 400 && res.statusCode !== 404) throw new Error(`SOURCE_DOWN: robots.txt returned HTTP ${res.statusCode}`);

function parseRobots(txt, ua) {
  const groups = []; let cur = null; let lastWasUA = false;
  for (let line of txt.split(/\r?\n/)) {
    line = line.replace(/#.*$/, '').trim(); if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/); if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === 'user-agent') { if (!lastWasUA) { cur = { agents: [], rules: [], crawlDelay: null }; groups.push(cur); } cur.agents.push(val.toLowerCase()); lastWasUA = true; continue; }
    lastWasUA = false; if (!cur) continue;
    if (key === 'allow' || key === 'disallow') { if (val) cur.rules.push({ allow: key === 'allow', path: val }); }
    else if (key === 'crawl-delay') cur.crawlDelay = parseFloat(val);
  }
  const token = ua.toLowerCase().split('/')[0];
  return groups.find((g) => g.agents.some((a) => a !== '*' && token.includes(a))) || groups.find((g) => g.agents.includes('*')) || { rules: [], crawlDelay: null };
}
const group = res.statusCode === 404 ? { rules: [], crawlDelay: null } : parseRobots(text, state.cfg.site.userAgent);
const robots = { rules: group.rules, crawlDelay: group.crawlDelay };

// Longest-match wins; Allow wins ties (RFC 9309). Supports * and $ wildcards.
function isAllowed(path, rules) {
  let best = null;
  for (const r of rules) {
    const re = new RegExp('^' + r.path.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
    if (re.test(path) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return !best || best.allow;
}
if (!isAllowed(state.plan.sitemapPath, robots.rules)) throw new Error(`ROBOTS_DISALLOWED: ${state.plan.sitemapPath} is disallowed by robots.txt`);
const throttleSeconds = Math.max(state.cfg.site.minDelaySeconds, robots.crawlDelay || 0);
return [{ json: { ...state, robots, throttleSeconds } }];
