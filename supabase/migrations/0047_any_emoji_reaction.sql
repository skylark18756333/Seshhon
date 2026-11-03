-- Any emoji as a reaction (Sarah, 2026-11-03): besides the quick six, people can pick any emoji from their phone's
-- keyboard. A reaction must be short (one emoji, with skin tone or joins) and have no letters, numbers or spaces.
-- Safe to run more than once. Compact on purpose: the phone SQL editor drops parts of long pasted queries.

alter table public.message_reactions drop constraint if exists message_reactions_emoji_check;
alter table public.message_reactions add constraint message_reactions_emoji_check check (char_length(emoji) between 1 and 16 and emoji !~ '[[:alnum:][:space:]!-~]');
insert into private.migration_log (file) values ('0047_any_emoji_reaction');
