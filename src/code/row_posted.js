// pw_posted row: the de-duplication store (one row per URL ever posted, scheduled or dry-run posted).
const s = $('Row: Run Log').last().json;
return [{ json: { url: s.item_url, title: s.item_title, content_type: s.content_type, category: s.category, fb_post_id: s.fb_post_id, status: s.status, posted_at: new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC' } }];
