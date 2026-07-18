begin;

create table if not exists public.elankav_project_number_counters (
  year integer primary key,
  last_sequence bigint not null default 0 check (last_sequence >= 0),
  updated_at timestamptz not null default now()
);

alter table public.elankav_project_number_counters enable row level security;

create or replace function public.elankav_reserve_project_number(
  target_year integer default extract(year from now())::integer
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  next_sequence bigint;
begin
  if target_year < 2000 or target_year > 9999 then
    raise exception 'Año inválido para número de proyecto: %', target_year
      using errcode = '22023';
  end if;

  insert into public.elankav_project_number_counters as counters (
    year,
    last_sequence,
    updated_at
  )
  values (
    target_year,
    1,
    now()
  )
  on conflict (year) do update
    set last_sequence = counters.last_sequence + 1,
        updated_at = now()
  returning last_sequence into next_sequence;

  return format('PRY-%s-%s', target_year, lpad(next_sequence::text, 6, '0'));
end;
$$;

revoke all on function public.elankav_reserve_project_number(integer) from public;
grant execute on function public.elankav_reserve_project_number(integer) to service_role;

insert into public.elankav_project_number_counters (year, last_sequence, updated_at)
select
  substring(project_number from '^PRY-([0-9]{4})-[0-9]{6}$')::integer as year,
  max(substring(project_number from '^PRY-[0-9]{4}-([0-9]{6})$')::bigint) as last_sequence,
  now()
from public.elankav_projects
where project_number ~ '^PRY-[0-9]{4}-[0-9]{6}$'
group by 1
on conflict (year) do update
set last_sequence = greatest(
      public.elankav_project_number_counters.last_sequence,
      excluded.last_sequence
    ),
    updated_at = now();

do $$
declare
  project_record record;
begin
  for project_record in
    select id, created_at
    from public.elankav_projects
    where project_number is null
    order by created_at asc, id asc
    for update
  loop
    update public.elankav_projects
    set project_number = public.elankav_reserve_project_number(
      extract(year from project_record.created_at)::integer
    )
    where id = project_record.id;
  end loop;
end;
$$;

alter table public.elankav_projects
  alter column project_number set not null;

commit;
