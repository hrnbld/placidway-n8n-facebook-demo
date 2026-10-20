// Shape one pw_runs row (columns must match the Data Table exactly). Used for pending / final / rejected states.
const s = $input.first().json;
const result = s.result || {};
return [{ json: {
  run_id: s.run.id, started_at: s.run.startedAt, finished_at: result.status === 'pending_approval' ? '' : new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC',
  trigger: s.run.trigger, mode: s.run.mode, content_type: s.item.contentType, category: s.item.category,
  item_url: s.item.url, item_title: s.page.title, image_url: s.page.image || '', post_text: s.post.message,
  chars_before_link: s.post.charsBeforeLink, attempts: s.attempt,
  guardrail: (s.guardrailHistory || []).map((g) => `#${g.attempt}:${g.rulesPass && g.llmPass ? 'pass' : 'fail(' + g.issues.length + ')'}`).join(' '),
  fb_post_id: result.fbPostId || '', status: result.status || 'unknown', error: result.error || '', review_url: result.reviewUrl || '',
} }];
