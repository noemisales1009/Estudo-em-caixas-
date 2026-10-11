-- Estudo em Caixas: onde os estudos de cada conta ficam guardados na nuvem.
-- Pode rodar de novo sem medo: nada do que já existe é apagado.

create table if not exists public.eec_itens (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  tipo text not null check (tipo in ('estudo', 'parte', 'sessao')),
  id text not null check (char_length(id) <= 100),
  dados jsonb not null check (jsonb_typeof(dados) = 'object' and octet_length(dados::text) <= 200000),
  atualizado_em timestamptz not null default now(),
  primary key (user_id, tipo, id)
);

alter table public.eec_itens enable row level security;

-- Cada pessoa só enxerga e altera as próprias linhas.
drop policy if exists eec_itens_dono on public.eec_itens;
create policy eec_itens_dono on public.eec_itens
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.eec_itens from anon;
grant select, insert, update, delete on public.eec_itens to authenticated;

create or replace function public.eec_tocar() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

drop trigger if exists eec_itens_tocar on public.eec_itens;
create trigger eec_itens_tocar before update on public.eec_itens
  for each row execute function public.eec_tocar();

select
  'eec_itens pronta' as resultado,
  (select relrowsecurity from pg_class where oid = 'public.eec_itens'::regclass) as protecao_ligada,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'eec_itens') as regras;
