// Normalise the Graph API response: /photos returns {id, post_id}, /feed returns {id}.
const s = $('Final Post').first().json;
const r = $input.first().json;
const fbPostId = r.post_id || r.id;
if (!fbPostId) throw new Error('FB_ERROR: Graph API returned no post id: ' + JSON.stringify(r).slice(0, 300));
return [{ json: { ...s, result: { status: s.fb.scheduleAt ? 'scheduled' : 'published', fbPostId, scheduledFor: s.fb.scheduleAt ? new Date(s.fb.scheduleAt * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '' } } }];
