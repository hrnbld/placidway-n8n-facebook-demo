const s = $('Build Review Request').first().json;
return [{ json: { ...s, result: { status: 'pending_approval', reviewUrl: s.approval.resumeUrl } } }];
