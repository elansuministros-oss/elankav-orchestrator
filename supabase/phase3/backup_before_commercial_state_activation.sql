begin;

do $$
begin
  if to_regclass('public.commercial_conversation_states') is not null then
    execute 'create table if not exists public.commercial_conversation_states_phase3_backup_20260801 as select * from public.commercial_conversation_states';
  end if;
end $$;

commit;
