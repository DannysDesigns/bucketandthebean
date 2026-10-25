create table public.espresso_dial_in_logs (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  barista_name text check (char_length(barista_name) <= 80),
  bean_name text check (char_length(bean_name) <= 80),
  roast_date date,
  bean_age_days numeric check (bean_age_days between 0 and 365),
  outdoor_humidity_pct numeric check (outdoor_humidity_pct between 0 and 100),
  outdoor_temp_f numeric check (outdoor_temp_f between -40 and 130),
  pressure_bar numeric check (pressure_bar > 0 and pressure_bar <= 15),
  dose_target_g numeric not null check (dose_target_g between 5 and 30),
  yield_target_g numeric not null check (yield_target_g between 5 and 120),
  time_target_s numeric not null check (time_target_s between 5 and 120),
  beta_s numeric not null check (beta_s > 0 and beta_s <= 5),
  beta_d numeric not null check (beta_d > 0 and beta_d <= 10),
  higher_is_coarser boolean not null default true,
  predicted_click integer check (predicted_click between -1000 and 1000),
  predicted_dose_g numeric check (predicted_dose_g between 5 and 30),
  final_click integer not null check (final_click between -1000 and 1000),
  final_dose_g numeric not null check (final_dose_g between 5 and 30),
  final_time_s numeric not null check (final_time_s between 5 and 120),
  virtual_setting numeric not null check (virtual_setting between -1000 and 1000),
  shots_count integer not null check (shots_count between 1 and 8),
  shots jsonb not null,
  drink_age_s numeric check (drink_age_s between 0 and 3600),
  notes text check (char_length(notes) <= 1000),
  constraint espresso_dial_in_logs_shots_check check (
    case
      when jsonb_typeof(shots) = 'array' then
        jsonb_array_length(shots) between 1 and 8
        and jsonb_array_length(shots) = shots_count
        and octet_length(shots::text) <= 2000
        and not jsonb_path_exists(
          shots,
          '$[*] ? (!(@.type() == "object" && @.click.type() == "number" && @.dose_g.type() == "number" && @.time_s.type() == "number" && @.click >= -1000 && @.click <= 1000 && @.dose_g >= 5 && @.dose_g <= 30 && @.time_s >= 5 && @.time_s <= 120))'
        )
      else false
    end
  )
);

create index espresso_dial_in_logs_created_at_idx
on public.espresso_dial_in_logs (created_at desc);

alter table public.espresso_dial_in_logs enable row level security;

-- Submissions are anonymous (no passcode), so the check constraints above are the abuse guard.
-- anon may insert and read history for predictions, but never sees barista names or notes,
-- cannot set id/created_at, and cannot update or delete.
revoke all on public.espresso_dial_in_logs from anon, authenticated;

create policy "public_insert_espresso_dial_in_logs"
on public.espresso_dial_in_logs
for insert
to anon
with check (true);

create policy "public_read_espresso_dial_in_logs"
on public.espresso_dial_in_logs
for select
to anon
using (true);

grant insert (
  barista_name, bean_name, roast_date, bean_age_days, outdoor_humidity_pct, outdoor_temp_f,
  pressure_bar, dose_target_g, yield_target_g, time_target_s, beta_s, beta_d, higher_is_coarser,
  predicted_click, predicted_dose_g, final_click, final_dose_g, final_time_s, virtual_setting,
  shots_count, shots, drink_age_s, notes
) on public.espresso_dial_in_logs to anon;

grant select (
  id, created_at, bean_name, roast_date, bean_age_days, outdoor_humidity_pct, outdoor_temp_f,
  pressure_bar, dose_target_g, yield_target_g, time_target_s, beta_s, beta_d, higher_is_coarser,
  predicted_click, predicted_dose_g, final_click, final_dose_g, final_time_s, virtual_setting,
  shots_count, shots, drink_age_s
) on public.espresso_dial_in_logs to anon;

grant select, insert, update, delete on public.espresso_dial_in_logs to service_role;
