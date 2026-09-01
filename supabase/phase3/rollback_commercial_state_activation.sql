begin;

drop table if exists public.commercial_conversation_states;

alter table if exists public.commercial_conversation_states_phase3_backup_20260801
  rename to commercial_conversation_states;

commit;
