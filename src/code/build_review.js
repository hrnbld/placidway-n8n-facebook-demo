// Build Review Request: draft + one-click approve/reject links (they resume the waiting execution).
const s = $input.first().json;
const resume = $execution.resumeUrl;
const sep = resume.includes('?') ? '&' : '?'; // n8n 2.x resume URLs already carry ?signature=...
const approveUrl = `${resume}${sep}decision=approve`;
const rejectUrl = `${resume}${sep}decision=reject`;
const text = [
  `*PlacidWay -> Facebook: draft needs approval* (run ${s.run.id}, ${s.cfg.dryRun ? 'DRY RUN' : 'LIVE'})`,
  `Source (${s.item.contentType}, ${s.item.category}): ${s.item.url}`,
  s.page.image ? `Image: ${s.page.image}` : 'Image: none (link post)',
  '', '```', s.post.message, '```', '',
  `Guardrails: passed on attempt ${s.guardrail.attempt} (rules + LLM review)`,
  `Approve: ${approveUrl}`, `Reject: ${rejectUrl}`, `Expires in ${$env.APPROVAL_TIMEOUT_HOURS || 24}h.`,
].join('\n');
const payload = s.cfg.review.format === 'slack' ? { text }
  : { event: 'approval_request', run_id: s.run.id, source_url: s.item.url, image_url: s.page.image, post: s.post.message, approve_url: approveUrl, reject_url: rejectUrl };
return [{ json: { ...s, approval: { approveUrl, rejectUrl, resumeUrl: resume, payload } } }];
