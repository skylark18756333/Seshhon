-- Didit is the chosen age check provider. The check stays off until switched on:
--   update public.app_settings set age_check_required = true;
-- (Yoti still works: set age_check_provider = 'yoti' and add the Yoti keys instead.)
alter table public.app_settings alter column age_check_provider set default 'didit';
update public.app_settings set age_check_provider = 'didit' where not age_check_required;
