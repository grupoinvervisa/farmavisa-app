create table if not exists public.farmavisa_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.farmavisa_state enable row level security;

create policy "Farmavisa state can be read publicly"
  on public.farmavisa_state for select
  to anon, authenticated
  using (id = 'main');

create policy "Farmavisa state can be inserted publicly"
  on public.farmavisa_state for insert
  to anon, authenticated
  with check (id = 'main');

create policy "Farmavisa state can be updated publicly"
  on public.farmavisa_state for update
  to anon, authenticated
  using (id = 'main')
  with check (id = 'main');
