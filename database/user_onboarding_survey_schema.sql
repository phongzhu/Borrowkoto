create type public.user_app_purpose as enum (
  'rent_item',
  'list_item',
  'both_rent_and_list',
  'looking_for_specific_item',
  'other'
);

create table public.user_onboarding_surveys (
  id uuid not null default gen_random_uuid (),
  user_id uuid not null,
  purpose public.user_app_purpose not null,
  other_purpose text null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint user_onboarding_surveys_pkey primary key (id),
  constraint user_onboarding_surveys_user_id_key unique (user_id),
  constraint user_onboarding_surveys_user_id_fkey foreign key (user_id) references profiles (id) on delete cascade,
  constraint user_onboarding_surveys_other_purpose_check check (
    (
      purpose <> 'other'::public.user_app_purpose
      or (
        other_purpose is not null
        and btrim(other_purpose) <> ''::text
      )
    )
  )
) tablespace pg_default;

create index if not exists idx_user_onboarding_surveys_purpose
on public.user_onboarding_surveys using btree (purpose) tablespace pg_default;

create trigger trg_user_onboarding_surveys_set_updated_at before
update on user_onboarding_surveys for each row
execute function set_updated_at ();

create table public.user_onboarding_survey_categories (
  id uuid not null default gen_random_uuid (),
  survey_id uuid not null,
  category_id uuid not null,
  created_at timestamp with time zone not null default now(),
  constraint user_onboarding_survey_categories_pkey primary key (id),
  constraint user_onboarding_survey_categories_unique unique (survey_id, category_id),
  constraint user_onboarding_survey_categories_survey_id_fkey foreign key (survey_id) references user_onboarding_surveys (id) on delete cascade,
  constraint user_onboarding_survey_categories_category_id_fkey foreign key (category_id) references categories (id) on delete cascade
) tablespace pg_default;

create index if not exists idx_user_onboarding_survey_categories_survey_id
on public.user_onboarding_survey_categories using btree (survey_id) tablespace pg_default;

create index if not exists idx_user_onboarding_survey_categories_category_id
on public.user_onboarding_survey_categories using btree (category_id) tablespace pg_default;
