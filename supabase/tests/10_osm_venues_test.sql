-- Checks for OpenStreetMap venue imports (migration 0010). Runs after 01 to 09 and reuses their helpers.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
insert into public.venues (osm_id, name, kind, lat, lng) values
  ('node/901', 'Import Bar', 'Bar', -31.95, 115.86), ('way/902', 'Import Pub', 'Pub', -32.05, 115.75)
on conflict (osm_id) do update set name = excluded.name, kind = excluded.kind, lat = excluded.lat, lng = excluded.lng;
-- The same import again, after the bar was renamed and moved on OpenStreetMap.
insert into public.venues (osm_id, name, kind, lat, lng) values
  ('node/901', 'Import Bar Renamed', 'Cocktail bar', -31.951, 115.861), ('way/902', 'Import Pub', 'Pub', -32.05, 115.75)
on conflict (osm_id) do update set name = excluded.name, kind = excluded.kind, lat = excluded.lat, lng = excluded.lng;
select public.expect((select count(*) from public.venues where osm_id in ('node/901', 'way/902')) = 2, 'running an import twice does not add venues twice');
select public.expect((select name from public.venues where osm_id = 'node/901') = 'Import Bar Renamed', 'a newer import updates the name');
select public.expect((select count(*) from public.venues where osm_id is null) >= 3, 'venues added by hand (no osm_id) are untouched');
select 'ALL OSM IMPORT CHECKS PASSED';
