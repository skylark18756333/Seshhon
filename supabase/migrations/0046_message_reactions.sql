-- Emoji reactions on sesh chat messages (Sarah, 2026-11-03). One reaction per person per message, from a short
-- list of fun emojis (never drinks). They are deleted with the message, so they go when the sesh ends.
-- get_messages now also sends each message's reactions: {"❤️": 2, ...} and the one you picked.
-- Friend messages are locked end to end and never stored, so their reactions travel inside the locked messages.
-- Safe to run more than once.
-- Written compactly (long statements on one line) because the phone SQL editor drops parts of long pasted queries.

create table if not exists public.message_reactions (message_id uuid not null references public.messages (id) on delete cascade, user_id uuid not null references public.profiles (id) on delete cascade, emoji text not null check (emoji in ('❤️', '😂', '🔥', '👍', '😮', '🙌')), created_at timestamptz not null default now(), primary key (message_id, user_id));
alter table public.message_reactions enable row level security;

create or replace function public.react_message(p_message uuid, p_emoji text) returns void
language plpgsql security definer set search_path = public as $f$
declare
  me uuid := auth.uid();
  v_sesh uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  select m.sesh_id into v_sesh from public.messages m where m.id = p_message;
  if v_sesh is null or not public.is_sesh_member(v_sesh, me) or not public.sesh_is_live(v_sesh) then raise exception 'That message has gone.'; end if;
  if coalesce(p_emoji, '') = '' or exists (select 1 from public.message_reactions r where r.message_id = p_message and r.user_id = me and r.emoji = p_emoji) then
    delete from public.message_reactions where message_id = p_message and user_id = me;
    return;
  end if;
  insert into public.message_reactions (message_id, user_id, emoji) values (p_message, me, p_emoji) on conflict (message_id, user_id) do update set emoji = excluded.emoji, created_at = now();
end $f$;

create or replace function public.reactions_for(p_message uuid, me uuid) returns jsonb
language sql stable security definer set search_path = public as $f$
  select coalesce(jsonb_object_agg(e.emoji, e.n), '{}'::jsonb) from (select r.emoji, count(*) as n from public.message_reactions r where r.message_id = p_message and (r.user_id = me or not public.blocked_between(r.user_id, me)) group by r.emoji) e;
$f$;

create or replace function public.get_messages(p_sesh uuid) returns jsonb
language plpgsql volatile security definer set search_path = public as $f$
declare
  me uuid := auth.uid();
  out jsonb;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not public.is_sesh_member(p_sesh, me) or not public.sesh_is_live(p_sesh) then return '[]'::jsonb; end if;
  if random() < 0.05 then perform public.purge_chat(); end if;
  select coalesce(jsonb_agg(t.x order by t.x_at), '[]'::jsonb) into out from (select jsonb_build_object('id', m.id, 'sender', m.sender, 'name', p.name, 'body', m.body, 'at', m.created_at, 'reactions', public.reactions_for(m.id, me), 'my_reaction', (select r.emoji from public.message_reactions r where r.message_id = m.id and r.user_id = me)) as x, m.created_at as x_at from public.messages m join public.profiles p on p.id = m.sender where m.sesh_id = p_sesh and (m.sender = me or not public.blocked_between(m.sender, me)) order by m.created_at desc limit 200) t;
  return out;
end $f$;

revoke all on function public.react_message(uuid, text) from public, anon;
grant execute on function public.react_message(uuid, text) to authenticated;
revoke all on function public.reactions_for(uuid, uuid) from public, anon, authenticated;
insert into private.migration_log (file) values ('0046_message_reactions');
