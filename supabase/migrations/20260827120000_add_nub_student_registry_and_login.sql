-- The university registry is the source of truth for student identity. Students
-- activate an imported record; they do not self-register academic information.

alter table public.profiles
  add column if not exists year_level smallint,
  add column if not exists nub_registry_managed boolean not null default false;

create table if not exists public.nub_student_registry (
  id uuid primary key default gen_random_uuid(),
  student_number text not null unique,
  email text not null unique,
  first_name text not null,
  middle_name text,
  last_name text not null,
  suffix text,
  school_code text not null references public.nub_schools(code),
  program_code text not null references public.nub_programs(code),
  year_level smallint not null check (year_level between 1 and 8),
  status text not null default 'active' check (status in ('active', 'inactive', 'graduated', 'suspended')),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  activated_at timestamptz,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nub_student_registry_email_format check (
    email = lower(btrim(email))
    and email ~ '^[^@[:space:]]+@students[.]nu-baliwag[.]edu[.]ph$'
  ),
  constraint nub_student_registry_number_format check (student_number ~ '^\d{4}-\d{6}$')
);

create index if not exists nub_student_registry_auth_user_idx
  on public.nub_student_registry(auth_user_id)
  where auth_user_id is not null;

create or replace function public.validate_nub_student_registry_program()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.nub_programs program
    where program.code = new.program_code
      and program.school_code = new.school_code
  ) then
    raise exception 'Program % does not belong to school %.', new.program_code, new.school_code;
  end if;

  new.email := lower(btrim(new.email));
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists nub_student_registry_validate on public.nub_student_registry;
create trigger nub_student_registry_validate
before insert or update on public.nub_student_registry
for each row execute function public.validate_nub_student_registry_program();

create or replace function public.sync_nub_student_registry_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.auth_user_id is null then
    return new;
  end if;

  insert into public.profiles (
    id,
    first_name,
    middle_name,
    last_name,
    suffix,
    role,
    campus_name,
    school_code,
    program_code,
    student_number,
    year_level,
    nub_registry_managed,
    is_verified,
    verification_status,
    account_status
  ) values (
    new.auth_user_id,
    new.first_name,
    nullif(new.middle_name, ''),
    new.last_name,
    nullif(new.suffix, ''),
    'user',
    'NU BALIWAG',
    new.school_code,
    new.program_code,
    new.student_number,
    new.year_level,
    true,
    true,
    'verified',
    case when new.status = 'active' then 'active' else 'inactive' end
  )
  on conflict (id) do update set
    first_name = excluded.first_name,
    middle_name = excluded.middle_name,
    last_name = excluded.last_name,
    suffix = excluded.suffix,
    campus_name = excluded.campus_name,
    school_code = excluded.school_code,
    program_code = excluded.program_code,
    student_number = excluded.student_number,
    year_level = excluded.year_level,
    nub_registry_managed = true,
    is_verified = true,
    verification_status = 'verified',
    account_status = excluded.account_status;

  return new;
end;
$$;

drop trigger if exists nub_student_registry_sync_profile on public.nub_student_registry;
create trigger nub_student_registry_sync_profile
after insert or update of auth_user_id, first_name, middle_name, last_name, suffix, school_code, program_code, student_number, year_level, status
on public.nub_student_registry
for each row execute function public.sync_nub_student_registry_profile();

-- Prevent a student from replacing university-owned identity data in the normal
-- editable profile form. Service-role/admin registry synchronizations remain able
-- to update these fields because they do not execute as the student's auth UID.
create or replace function public.preserve_nub_registry_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  registry public.nub_student_registry%rowtype;
begin
  if auth.uid() is distinct from old.id then
    return new;
  end if;

  select * into registry
  from public.nub_student_registry
  where auth_user_id = old.id;

  if not found then
    return new;
  end if;

  new.first_name := registry.first_name;
  new.middle_name := nullif(registry.middle_name, '');
  new.last_name := registry.last_name;
  new.suffix := nullif(registry.suffix, '');
  new.campus_name := 'NU BALIWAG';
  new.school_code := registry.school_code;
  new.program_code := registry.program_code;
  new.student_number := registry.student_number;
  new.year_level := registry.year_level;
  new.nub_registry_managed := true;
  new.is_verified := true;
  new.verification_status := 'verified';
  return new;
end;
$$;

drop trigger if exists profiles_preserve_nub_registry_fields on public.profiles;
create trigger profiles_preserve_nub_registry_fields
before update on public.profiles
for each row execute function public.preserve_nub_registry_profile_fields();

create or replace function public.complete_nub_student_activation()
returns public.nub_student_registry
language plpgsql
security definer
set search_path = public
as $$
declare
  registry public.nub_student_registry;
begin
  update public.nub_student_registry
  set activated_at = coalesce(activated_at, now()), updated_at = now()
  where auth_user_id = auth.uid()
    and status = 'active'
  returning * into registry;

  if registry.id is null then
    raise exception 'No active NU Baliwag student record is linked to this account.';
  end if;

  return registry;
end;
$$;

alter table public.nub_student_registry enable row level security;

drop policy if exists "Students can read their own NUB registry record" on public.nub_student_registry;
create policy "Students can read their own NUB registry record"
on public.nub_student_registry for select to authenticated
using (auth_user_id = (select auth.uid()));

drop policy if exists "Admins can manage the NUB student registry" on public.nub_student_registry;
create policy "Admins can manage the NUB student registry"
on public.nub_student_registry for all to authenticated
using (
  exists (
    select 1 from public.profiles profile
    where profile.id = (select auth.uid())
      and lower(profile.role::text) = 'admin'
  )
)
with check (
  exists (
    select 1 from public.profiles profile
    where profile.id = (select auth.uid())
      and lower(profile.role::text) = 'admin'
  )
);

revoke all on public.nub_student_registry from anon;
grant select, insert, update, delete on public.nub_student_registry to authenticated;
revoke all on function public.complete_nub_student_activation() from public;
grant execute on function public.complete_nub_student_activation() to authenticated;

