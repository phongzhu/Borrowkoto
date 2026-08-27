-- Expand the Registrar-managed roster and make enrollment status the access rule.

alter table public.nub_student_registry
  add column if not exists phone_number text,
  add column if not exists date_of_birth date,
  add column if not exists street text,
  add column if not exists barangay text,
  add column if not exists city text,
  add column if not exists province text,
  add column if not exists region text,
  add column if not exists country text not null default 'Philippines',
  add column if not exists school_status text;

update public.nub_student_registry
set school_status = case
  when status = 'active' then 'Enrolled'
  when status = 'graduated' then 'Graduated'
  else 'Dropped'
end
where school_status is null;

alter table public.nub_student_registry
  alter column school_status set default 'Enrolled',
  alter column school_status set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'nub_student_registry_school_status_check'
  ) then
    alter table public.nub_student_registry
      add constraint nub_student_registry_school_status_check
      check (school_status in ('Enrolled', 'Dropped', 'Graduated'));
  end if;
end $$;

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
  new.school_status := initcap(lower(btrim(new.school_status)));
  if new.school_status not in ('Enrolled', 'Dropped', 'Graduated') then
    raise exception 'school_status must be Enrolled, Dropped, or Graduated.';
  end if;

  new.status := case
    when new.school_status = 'Enrolled' then 'active'
    when new.school_status = 'Graduated' then 'graduated'
    else 'inactive'
  end;
  new.country := coalesce(nullif(btrim(new.country), ''), 'Philippines');
  new.updated_at := now();
  return new;
end;
$$;

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
    phone_number,
    date_of_birth,
    street,
    barangay,
    city,
    province,
    region,
    country,
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
    nullif(new.phone_number, ''),
    new.date_of_birth,
    nullif(new.street, ''),
    nullif(new.barangay, ''),
    nullif(new.city, ''),
    nullif(new.province, ''),
    nullif(new.region, ''),
    coalesce(nullif(new.country, ''), 'Philippines'),
    true,
    true,
    'verified',
    case when new.school_status = 'Enrolled' then 'active' else 'inactive' end
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
    phone_number = coalesce(public.profiles.phone_number, excluded.phone_number),
    date_of_birth = coalesce(public.profiles.date_of_birth, excluded.date_of_birth),
    street = coalesce(public.profiles.street, excluded.street),
    barangay = coalesce(public.profiles.barangay, excluded.barangay),
    city = coalesce(public.profiles.city, excluded.city),
    province = coalesce(public.profiles.province, excluded.province),
    region = coalesce(public.profiles.region, excluded.region),
    country = coalesce(public.profiles.country, excluded.country),
    nub_registry_managed = true,
    is_verified = true,
    verification_status = 'verified',
    account_status = excluded.account_status;

  return new;
end;
$$;

drop trigger if exists nub_student_registry_sync_profile on public.nub_student_registry;
create trigger nub_student_registry_sync_profile
after insert or update on public.nub_student_registry
for each row execute function public.sync_nub_student_registry_profile();

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
    and school_status = 'Enrolled'
  returning * into registry;

  if registry.id is null then
    raise exception 'No enrolled NU Baliwag student record is linked to this account.';
  end if;

  return registry;
end;
$$;

update public.nub_student_registry
set updated_at = now()
where auth_user_id is not null;

comment on column public.nub_student_registry.school_status is
  'Registrar status. Only Enrolled records are permitted to activate or access the student application.';
