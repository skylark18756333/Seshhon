-- Example venues and deals, so the app has something to show before real venues sign up.
-- None of these are real places. The app labels them "Example".
-- Safe to run more than once. To remove them later: delete from public.venues where is_example;

insert into public.venues (id, name, kind, closes, is_example, lat, lng) values
  ('a0000000-0000-4000-8000-000000000001', 'Lowtide Bar', 'Cocktail bar', 'open till 1am', true, -31.9478, 115.8571),
  ('a0000000-0000-4000-8000-000000000002', 'Bodega Nine', 'Pizza bar', 'open till 12am', true, -31.9465, 115.8605),
  ('a0000000-0000-4000-8000-000000000003', 'The Paper Lantern', 'Live music venue', 'open till 12am', true, -31.9512, 115.8540)
on conflict (id) do nothing;
update public.venues set opening_hours = 'Mo-Su 16:00-01:00', hours_source = 'osm' where id = 'a0000000-0000-4000-8000-000000000001' and opening_hours is null;
update public.venues set opening_hours = 'Tu-Su 12:00-24:00; Mo off', hours_source = 'osm' where id = 'a0000000-0000-4000-8000-000000000002' and opening_hours is null;
update public.venues set opening_hours = 'We-Sa 19:00-24:00', hours_source = 'osm' where id = 'a0000000-0000-4000-8000-000000000003' and opening_hours is null;

insert into public.deals (id, venue_id, type, title, start_time, end_time, is_alcohol, discount_pct) values
  ('d0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Food', 'Free share plate for groups of 4+', '17:00', '23:00', false, null),
  ('d0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'Drinks', 'Happy hour: 25% off house drinks', '17:00', '18:00', true, 25),
  ('d0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000002', 'Food', '2-for-1 pizzas', '17:00', '21:00', false, null),
  ('d0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000003', 'Entry', 'Free entry for groups of 4+', '20:00', '23:59:59', false, null),
  ('d0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000003', 'Events', 'Live music tonight, table held for your sesh', '19:00', '23:00', false, null),
  -- Runs all day so the deal code screen can be tried at any time.
  ('d0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000002', 'Food', 'Test deal: free garlic bread, any time', '00:00', '23:59:59', false, null)
on conflict (id) do nothing;
