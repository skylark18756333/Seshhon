-- Real venues imported from OpenStreetMap. osm_id (for example "node/123") ties a venue to its
-- OpenStreetMap entry, so running a newer import updates venues instead of adding them twice.
alter table public.venues add column if not exists osm_id text;
create unique index if not exists venues_osm_id_key on public.venues (osm_id);
