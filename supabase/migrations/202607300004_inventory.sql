-- =====================================================================
-- Inventory — items with stock-in / stock-out movements that update the
-- quantity on hand. Maintained by the Accounting Manager.
-- =====================================================================

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  unit text not null default 'pc',
  quantity_on_hand integer not null default 0 check (quantity_on_hand >= 0),
  unit_value_centavos bigint not null default 0 check (unit_value_centavos >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  movement_type text not null check (movement_type in ('in','out')),
  quantity integer not null check (quantity > 0),
  remarks text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists inventory_movements_item_idx on public.inventory_movements(item_id, created_at desc);

alter table public.inventory_items enable row level security;
alter table public.inventory_movements enable row level security;
drop policy if exists inventory_items_staff_read on public.inventory_items;
create policy inventory_items_staff_read on public.inventory_items for select to authenticated using (public.has_staff_role());
drop policy if exists inventory_items_acct_write on public.inventory_items;
create policy inventory_items_acct_write on public.inventory_items for all to authenticated using (public.has_any_role(array['admin','accounting'])) with check (public.has_any_role(array['admin','accounting']));
drop policy if exists inventory_movements_staff_read on public.inventory_movements;
create policy inventory_movements_staff_read on public.inventory_movements for select to authenticated using (public.has_staff_role());
drop policy if exists inventory_movements_acct_write on public.inventory_movements;
create policy inventory_movements_acct_write on public.inventory_movements for all to authenticated using (public.has_any_role(array['admin','accounting'])) with check (public.has_any_role(array['admin','accounting']));

-- Atomically record a stock movement and update the quantity on hand.
create or replace function public.record_inventory_movement(target_item uuid, target_type text, target_quantity integer, target_remarks text)
returns public.inventory_items language plpgsql security definer set search_path = public as $$
declare item_row public.inventory_items; new_qty integer;
begin
  if not public.has_any_role(array['admin','accounting']) then raise exception 'Not authorized'; end if;
  if target_type not in ('in','out') then raise exception 'Invalid movement type'; end if;
  if target_quantity <= 0 then raise exception 'Quantity must be positive'; end if;
  select * into item_row from public.inventory_items where id = target_item and active;
  if item_row.id is null then raise exception 'Inventory item not found'; end if;
  new_qty := item_row.quantity_on_hand + case when target_type = 'in' then target_quantity else -target_quantity end;
  if new_qty < 0 then raise exception 'Not enough stock on hand'; end if;
  insert into public.inventory_movements(item_id, movement_type, quantity, remarks, created_by)
  values(target_item, target_type, target_quantity, nullif(trim(coalesce(target_remarks, '')), ''), auth.uid());
  update public.inventory_items set quantity_on_hand = new_qty, updated_at = now() where id = target_item returning * into item_row;
  return item_row;
end $$;
grant execute on function public.record_inventory_movement(uuid, text, integer, text) to authenticated;
