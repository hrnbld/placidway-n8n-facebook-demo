// A rejected draft's URL is also remembered, so the same item is not proposed to the reviewer again tomorrow.
const s = $('Row: Rejected').last().json;
return [{ json: { url: s.item_url, title: s.item_title, content_type: s.content_type, category: s.category, fb_post_id: '', status: s.status, posted_at: new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC' } }];
