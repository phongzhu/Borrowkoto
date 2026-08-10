alter table public.ui_settings
  add column if not exists header_font_family text not null
    default '"Gilroy", "Montserrat", "Avenir Next", Arial, sans-serif',
  add column if not exists body_font_family text not null
    default '"Dustin Sans", "Avenir Next", "Segoe UI", Arial, sans-serif';

update public.ui_settings
set
  header_font_family = '"Gilroy", "Montserrat", "Avenir Next", Arial, sans-serif',
  body_font_family = '"Dustin Sans", "Avenir Next", "Segoe UI", Arial, sans-serif';

comment on column public.ui_settings.header_font_family is
  'CSS font-family stack applied system-wide to headings and display text.';

comment on column public.ui_settings.body_font_family is
  'CSS font-family stack applied system-wide to body copy and form controls.';
