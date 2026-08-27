-- PostgreSQL resolves the CASE expression below as text. Cast it explicitly to
-- the profiles.account_status enum so first-time registry linking can create or
-- update the student's profile without failing.

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
    section,
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
    new.section,
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
    (case when new.school_status = 'Enrolled' then 'active' else 'inactive' end)::public.account_status
  )
  on conflict (id) do update set
    first_name = excluded.first_name,
    middle_name = excluded.middle_name,
    last_name = excluded.last_name,
    suffix = excluded.suffix,
    campus_name = excluded.campus_name,
    school_code = excluded.school_code,
    program_code = excluded.program_code,
    section = excluded.section,
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
