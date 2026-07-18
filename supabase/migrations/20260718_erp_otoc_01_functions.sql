begin;

create or replace function public.elankav_create_work_order(
  target_project_id uuid,
  target_quotation_id uuid,
  target_generated_by text,
  target_generated_by_role text,
  target_payload jsonb default '{}'::jsonb
)
returns setof public.elankav_work_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  project_row public.elankav_projects%rowtype;
  target_year integer := extract(year from now())::integer;
  next_sequence bigint;
  generated_number text;
begin
  select * into project_row
  from public.elankav_projects
  where id = target_project_id;

  if not found then
    raise exception 'Proyecto no encontrado' using errcode = 'P0002';
  end if;

  if project_row.quotation_id <> target_quotation_id then
    raise exception 'La cotización no corresponde al proyecto' using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtext('elankav_work_order_number'), target_year);

  select coalesce(max(substring(work_order_number from '^OT-[0-9]{4}-([0-9]{6})$')::bigint), 0) + 1
    into next_sequence
  from public.elankav_work_orders
  where work_order_number ~ format('^OT-%s-[0-9]{6}$', target_year);

  generated_number := format('OT-%s-%s', target_year, lpad(next_sequence::text, 6, '0'));

  return query
  insert into public.elankav_work_orders (
    work_order_number,
    project_id,
    quotation_id,
    generated_by,
    generated_by_role,
    status,
    payload
  ) values (
    generated_number,
    target_project_id,
    target_quotation_id,
    target_generated_by,
    target_generated_by_role,
    'pending',
    coalesce(target_payload, '{}'::jsonb)
  )
  returning *;
end;
$$;

create or replace function public.elankav_create_purchase_order(
  target_project_id uuid,
  target_supplier_id text,
  target_generated_by text,
  target_payload jsonb default '{}'::jsonb
)
returns setof public.elankav_purchase_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  target_year integer := extract(year from now())::integer;
  next_sequence bigint;
  generated_number text;
begin
  if not exists (select 1 from public.elankav_projects where id = target_project_id) then
    raise exception 'Proyecto no encontrado' using errcode = 'P0002';
  end if;

  if nullif(trim(target_supplier_id), '') is null then
    raise exception 'Proveedor obligatorio' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('elankav_purchase_order_number'), target_year);

  select coalesce(max(substring(purchase_order_number from '^OC-[0-9]{4}-([0-9]{6})$')::bigint), 0) + 1
    into next_sequence
  from public.elankav_purchase_orders
  where purchase_order_number ~ format('^OC-%s-[0-9]{6}$', target_year);

  generated_number := format('OC-%s-%s', target_year, lpad(next_sequence::text, 6, '0'));

  return query
  insert into public.elankav_purchase_orders (
    purchase_order_number,
    project_id,
    supplier_id,
    generated_by,
    status,
    blocks_production,
    payload
  ) values (
    generated_number,
    target_project_id,
    trim(target_supplier_id),
    target_generated_by,
    'draft',
    true,
    coalesce(target_payload, '{}'::jsonb)
  )
  returning *;
end;
$$;

revoke all on function public.elankav_create_work_order(uuid, uuid, text, text, jsonb) from public;
revoke all on function public.elankav_create_purchase_order(uuid, text, text, jsonb) from public;
grant execute on function public.elankav_create_work_order(uuid, uuid, text, text, jsonb) to service_role;
grant execute on function public.elankav_create_purchase_order(uuid, text, text, jsonb) to service_role;

commit;
