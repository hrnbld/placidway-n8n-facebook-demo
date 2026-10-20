// Dashboard: render the run log as one self-contained HTML page (scheduled, pending, published, failed).
const rows = $input.all().map((i) => i.json).filter((r) => r.run_id);
rows.sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const count = (st) => rows.filter((r) => r.status === st).length;
const colors = { published: '#1a7f37', scheduled: '#0969da', dry_run: '#6e7781', pending_approval: '#9a6700', rejected: '#cf222e', expired: '#cf222e', failed: '#cf222e', guardrail_blocked: '#bc4c00', skipped: '#6e7781' };
const card = (label, n) => `<div class="k"><b>${n}</b><span>${label}</span></div>`;
const tr = rows.map((r) => `<tr>
<td>${esc(String(r.started_at).replace('T', ' ').slice(0, 16))}<br><small>${esc(r.trigger)} · ${esc(r.mode)}</small></td>
<td><span class="st" style="background:${colors[r.status] || '#6e7781'}">${esc(r.status)}</span>${r.status === 'pending_approval' && r.review_url ? `<br><a href="${esc(r.review_url)}${String(r.review_url).includes('?') ? '&' : '?'}decision=approve">approve</a> · <a href="${esc(r.review_url)}${String(r.review_url).includes('?') ? '&' : '?'}decision=reject">reject</a>` : ''}</td>
<td>${esc(r.content_type)}<br><small>${esc(r.category)}</small></td>
<td>${r.item_url ? `<a href="${esc(r.item_url)}">${esc(r.item_title || r.item_url)}</a>` : ''}${r.image_url ? `<br><img src="${esc(r.image_url)}" loading="lazy">` : ''}</td>
<td><pre>${esc(r.post_text)}</pre>${r.error ? `<div class="err">${esc(r.error)}</div>` : ''}</td>
<td><small>${esc(r.fb_post_id)}</small><br><small>${esc(r.guardrail)}</small><br><small>${r.chars_before_link ? esc(r.chars_before_link) + ' chars' : ''}</small></td></tr>`).join('');
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PlacidWay → Facebook · Run dashboard</title><style>
body{font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;margin:24px;color:#1f2328;background:#f6f8fa}
h1{font-size:20px;margin:0 0 4px}.sub{color:#59636e;margin-bottom:16px}.ks{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px}
.k{background:#fff;border:1px solid #d1d9e0;border-radius:8px;padding:10px 14px;min-width:110px}.k b{display:block;font-size:22px}.k span{color:#59636e;font-size:12px}
table{border-collapse:collapse;width:100%;background:#fff;border:1px solid #d1d9e0}td,th{border-top:1px solid #d1d9e0;padding:8px;vertical-align:top;text-align:left}
th{background:#f6f8fa;font-size:12px;text-transform:uppercase;color:#59636e}pre{white-space:pre-wrap;margin:0;font:13px/1.4 system-ui;max-width:460px}
img{max-width:160px;border-radius:6px;margin-top:6px}.st{color:#fff;border-radius:10px;padding:2px 8px;font-size:12px}.err{color:#cf222e;font-size:12px;margin-top:6px;max-width:460px}small{color:#59636e}
</style></head><body><h1>PlacidWay → Facebook · daily post runs</h1>
<div class="sub">Test page: ${esc($env.FB_PAGE_NAME || 'NeuPix')} · ${rows.length} runs · generated ${esc(new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC'.slice(0, 16).replace('T', ' '))} UTC</div>
<div class="ks">${card('published', count('published'))}${card('scheduled', count('scheduled'))}${card('dry runs', count('dry_run'))}${card('pending approval', count('pending_approval'))}${card('blocked by guardrails', count('guardrail_blocked'))}${card('rejected / expired', count('rejected') + count('expired'))}${card('failed', count('failed'))}</div>
<table><tr><th>Run</th><th>Status</th><th>Type</th><th>Source</th><th>Post</th><th>FB id · checks</th></tr>${tr || '<tr><td colspan=6>No runs yet.</td></tr>'}</table></body></html>`;
return [{ json: { html } }];
