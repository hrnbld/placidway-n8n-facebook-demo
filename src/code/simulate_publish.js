// DRY RUN: build exactly what would be sent to the Graph API, but send nothing.
const s = $('Final Post').first().json;
const fbPostId = `dryrun_${s.run.id}_${Date.now()}`;
return [{ json: { ...s, result: { status: 'dry_run', fbPostId,
  simulatedRequest: { method: 'POST', url: s.fb.url, headers: { Authorization: 'Bearer <FB_PAGE_TOKEN>' }, body: s.fb.body } } } }];
