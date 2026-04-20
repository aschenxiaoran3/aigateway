-- Repair stale published_at values on non-published snapshots so draft ordering
-- and default UI selection do not get polluted by historical publish timestamps.
UPDATE gateway_wiki_snapshots
SET published_at = NULL
WHERE published_at IS NOT NULL
  AND (publish_status IS NULL OR publish_status <> 'published');
