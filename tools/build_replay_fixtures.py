#!/usr/bin/env python3
"""Build the offline REPLAY MIRROR used to test the workflow inside a sandbox whose
datacenter IP receives a Cloudflare challenge from placidway.com.

Inputs (all real PlacidWay data, captured 2026-10-20):
  research/robots.txt                  - fetched verbatim from https://www.placidway.com/robots.txt
  research/sitemap_*.xml               - sitemaps fetched verbatim (via a non-blocked fetcher)
  research/captures/*.md               - page text captured verbatim in a real browser

Outputs (fixtures/replay/):
  robots.txt, sitemaps filtered to the captured URLs (entries copied verbatim),
  and one HTML file per captured page. The HTML is RECONSTRUCTED from captured text
  (raw markup could not be saved), wrapped in realistic page chrome: navigation,
  meta tags, a 'Medical Disclaimer' block and a related-packages carousel with prices
  (so the parser's main-content cut-off is exercised like on the live site).
"""
import html, os, re, json
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
R = os.path.join(ROOT, 'research'); OUT = os.path.join(ROOT, 'fixtures', 'replay')
os.makedirs(OUT, exist_ok=True)

SITEMAPS = {  # path on site -> (source file, captured ids)
    '/1/sitemap_articles.xml': ('sitemap_articles.xml', ['/article/9795/', '/article/7649/']),
    '/1/sitemap_packages.xml': ('sitemap_packages.xml', ['/package/7041/', '/package/8457/']),
    '/sitemap/1/sitemap_answers.xml': ('sitemap_answers.xml', ['/answer-detail/571066/', '/answer-detail/569700/']),
}
for path, (src, keys) in SITEMAPS.items():
    s = open(os.path.join(R, src), encoding='utf-8').read()
    head = s[:s.index('<url>')]
    urls = [u for u in re.findall(r'<url>.*?</url>', s, re.S) if any(k in u for k in keys)]
    dst = os.path.join(OUT, path.lstrip('/'))
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    open(dst, 'w', encoding='utf-8').write(head + '\n'.join(urls) + '\n</urlset>\n')

open(os.path.join(OUT, 'robots.txt'), 'w').write(open(os.path.join(R, 'robots.txt')).read())

def s3(handle):
    m = re.search(r'(https://placidwaycdn\.s3\.amazonaws\.com/[^\s)"]+)', handle or '')
    return m.group(1) if m else ''

NAV = '''<header><a href="https://www.placidway.com"><img src="/frontend/images/PlacidWay-logo-opt.png" alt="Placidway Logo"></a>
<nav><ul><li><a href="/search-medical-centers/All/All/1">Centers</a></li><li><a href="/search-medical-packages/All/All/1">Packages</a></li>
<li><a href="/find-cost-search/">Pricing</a></li><li><a href="/search-medical-articles/All/All/1">Articles</a></li><li><a href="/search-medical-answers/All/All/1">Blog</a></li></ul></nav></header>'''
TAIL = '''<h3>Medical Disclaimer</h3><p>This content is for educational purposes only and does not provide medical advice.</p>
<section class="related"><h2>Request your Free Quote</h2>
<div class="card"><p>Price starting from $3,000</p><h3>Cost Effective Gastric Balloon Surgery Package in Tijuana, Mexico</h3></div>
<div class="card"><p>Price starting from $9,699</p><h3>Hospital Velmar Gastric Bypass Package in Ensenada, Mexico</h3></div></section>
<footer><h2>Trusted Medical Tourism Platform Since 2007</h2><p>60+ Countries 2k+ Clinics 1.1M+ Patients Served Since 2007</p>
<p>&copy; PlacidWay, LLC 2007 - Present. All Rights Reserved</p></footer>'''

def body_html(lines):
    out, table = [], []
    def flush():
        if table:
            out.append('<table>' + ''.join('<tr>' + ''.join(f'<td>{html.escape(c.strip())}</td>' for c in r.split('|')) + '</tr>' for r in table) + '</table>')
            table.clear()
    for ln in lines:
        ln = ln.rstrip()
        if not ln.strip():
            flush(); continue
        if ' | ' in ln:
            table.append(ln); continue
        flush()
        if len(ln) < 90 and not ln.endswith(('.', '?', ':', '!')) and not re.match(r'^[\$\d]', ln):
            out.append(f'<h3>{html.escape(ln)}</h3>')
        else:
            out.append(f'<p>{html.escape(ln)}</p>')
    flush()
    return '\n'.join(out)

# og:* values observed on the live page via a non-blocked fetcher (2026-10-20)
KNOWN_META = {
  '/article/9795/Lost-Weight-With-Ozempic-or-Mounjaro-Why-Patients-Are-Considering-Body-Contouring-in-Mexico': {
    'description': 'Lost weight with GLP-1 medication? Compare body contouring in Mexico, costs, tummy tucks, body lifts, recovery, safety and surgeon selection.',
    'image': 'https://www.placidway.com/cdn-cgi/image/quality=85,fit=pad,width=1200,height=630/https://placidwaycdn.s3.amazonaws.com/images/article_thumb/1792406582Images-(PS)-(5).png'},
}
index = {}
for fn in sorted(os.listdir(os.path.join(R, 'captures'))):
    if not fn.endswith('.md'): continue
    raw = open(os.path.join(R, 'captures', fn), encoding='utf-8').read().split('\n')
    meta, i = {}, 0
    while i < len(raw) and not raw[i].startswith('BODY:'):
        if ':' in raw[i]:
            k, v = raw[i].split(':', 1); meta[k.strip()] = v.strip()
        i += 1
    body = raw[i + 1:]
    url = meta['URL']; path = re.sub(r'^https://www\.placidway\.com', '', url)
    known = KNOWN_META.get(path, {})
    img = known.get('image') or s3(meta.get('FEATURED_IMAGE', ''))
    og_img = f'<meta property="og:image" content="{html.escape(img)}">' if img else ''
    if known.get('description'):
        og_img += f'\n<meta property="og:description" content="{html.escape(known["description"])}">\n<meta name="description" content="{html.escape(known["description"])}">'
    doc = f'''<!DOCTYPE html>
<!-- REPLAY FIXTURE: reconstructed from verbatim page text captured in a real browser on 2026-10-20 ({html.escape(url)}).
     Not PlacidWay's raw markup. Used only for offline testing in a Cloudflare-challenged sandbox. -->
<html lang="en"><head><meta charset="utf-8"><title>{html.escape(meta.get('TITLE',''))}</title>
<meta property="og:title" content="{html.escape(meta.get('TITLE',''))}">
<meta property="og:type" content="article">{og_img}
<link rel="canonical" href="{html.escape(url)}">
<script>window.dataLayer=[];</script><style>.x{{}}</style></head>
<body>{NAV}
<main><div class="breadcrumb"><a href="https://www.placidway.com">Home</a></div>
<h1>{html.escape(meta.get('H1',''))}</h1>
<div class="content">
{body_html(body)}
</div></main>
{TAIL}
</body></html>'''
    dst = os.path.join(OUT, path.lstrip('/'))
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    open(dst, 'w', encoding='utf-8').write(doc)
    index[path] = {'file': os.path.relpath(dst, OUT), 'title': meta.get('TITLE'), 'image': img}
json.dump(index, open(os.path.join(OUT, 'index.json'), 'w'), indent=2)
print(json.dumps(index, indent=1))
