// Final Post: freeze the approved text and build the exact Graph API request bodies.
const s = $input.first().json;
const delay = s.cfg.fb.scheduleDelayMinutes;
const scheduleAt = delay > 0 ? Math.floor(Date.now() / 1000) + Math.max(11, delay) * 60 : null; // Graph needs >= 10 min ahead (max 30 days)
// Publish now with an image -> POST /{page}/photos (image + caption; the link is inside the caption).
// Scheduled, or no image   -> POST /{page}/feed with link (Facebook renders the page's og:image as a link card).
// Meta documents scheduling on /feed (published=false + scheduled_publish_time + unpublished_content_type=SCHEDULED);
// scheduling a single /photos upload directly is not the documented path, so we do not rely on it.
const usePhoto = !!s.page.image && !scheduleAt;
const sched = scheduleAt ? { published: false, scheduled_publish_time: scheduleAt, unpublished_content_type: 'SCHEDULED' } : { published: true };
const endpoint = usePhoto ? 'photos' : 'feed';
const fb = {
  endpoint,
  url: `${s.cfg.fb.graphBase}/${s.cfg.fb.version}/${s.cfg.fb.pageId || '{FB_PAGE_ID}'}/${endpoint}`,
  body: usePhoto ? { url: s.page.image, caption: s.post.message, published: true } : { message: s.post.message, link: s.item.url, ...sched },
  scheduleAt,
};
const { rewrite, ...clean } = s;
return [{ json: { ...clean, fb } }];
