-- Estudo em Caixas: onde os estudos e as ideias de cada conta ficam guardados na nuvem.
-- Pode rodar de novo sem medo: nenhum estudo e nenhuma ideia são apagados.

create table if not exists public.eec_itens (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  tipo text not null constraint eec_itens_tipo_check check (tipo in ('estudo', 'parte', 'sessao', 'ideia')),
  id text not null check (char_length(id) <= 100),
  dados jsonb not null check (jsonb_typeof(dados) = 'object' and octet_length(dados::text) <= 200000),
  atualizado_em timestamptz not null default now(),
  primary key (user_id, tipo, id)
);

-- Tabela criada antes de existirem as ideias: ela só aceitava três tipos. Troca a regra antiga
-- (seja qual for o nome que o banco deu a ela) pela que aceita também 'ideia'.
do $$
declare regra record;
begin
  for regra in
    select conname from pg_constraint
    where conrelid = 'public.eec_itens'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%tipo%' and pg_get_constraintdef(oid) not like '%ideia%'
  loop
    execute format('alter table public.eec_itens drop constraint %I', regra.conname);
  end loop;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.eec_itens'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%ideia%'
  ) then
    alter table public.eec_itens add constraint eec_itens_tipo_check
      check (tipo in ('estudo', 'parte', 'sessao', 'ideia'));
  end if;
end $$;

-- Ideias guardadas pela primeira versão da página Ideias, quando ainda eram um estudo na situação
-- "idea": passam para o tipo próprio, só com os campos de uma ideia. A que já subiu com o tipo
-- novo fica valendo, e só a cópia antiga dela é apagada.
delete from public.eec_itens velha
where velha.tipo = 'estudo' and velha.dados->>'status' = 'idea'
  and exists (
    select 1 from public.eec_itens nova
    where nova.user_id = velha.user_id and nova.tipo = 'ideia' and nova.id = velha.id
  );

update public.eec_itens
set tipo = 'ideia',
    dados = jsonb_build_object(
      'id', dados->'id',
      'title', dados->'title',
      'note', coalesce(dados->'goal', '""'::jsonb),
      'box', coalesce(dados->'box', '""'::jsonb),
      'image', coalesce(dados->'image', '""'::jsonb),
      'created', coalesce(dados->'created', '0'::jsonb)
    )
where tipo = 'estudo' and dados->>'status' = 'idea';

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

-- Arquivos PDF dos estudos: um espaço fechado (não público), só para PDF, até 50 MB por arquivo.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('eec-arquivos', 'eec-arquivos', false, 52428800, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Cada pessoa só enxerga e altera os arquivos da própria pasta, que leva o id da conta dela.
drop policy if exists eec_arquivos_dono on storage.objects;
create policy eec_arquivos_dono on storage.objects
  for all to authenticated
  using (bucket_id = 'eec-arquivos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'eec-arquivos' and (storage.foldername(name))[1] = (select auth.uid())::text);

select
  'eec_itens pronta' as resultado,
  (select relrowsecurity from pg_class where oid = 'public.eec_itens'::regclass) as protecao_ligada,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'eec_itens') as regras,
  (select count(*) from pg_constraint where conrelid = 'public.eec_itens'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%ideia%') as aceita_ideias,
  (select count(*) from storage.buckets where id = 'eec-arquivos' and not public) as espaco_de_pdf,
  (select count(*) from pg_policies where schemaname = 'storage' and policyname = 'eec_arquivos_dono') as regra_dos_pdfs;
