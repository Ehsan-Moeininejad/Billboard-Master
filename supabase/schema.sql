-- ══════════════════════════════════════════════════════════════════════
-- بیلبوردسنج — حساب کاربری، اشتراک، تخفیف و پنل مدیریت (Supabase / Postgres)
-- در Supabase: SQL Editor → New query → کل این فایل را بچسبانید → Run.
-- اجرای دوباره بی‌خطر است (همه چیز if not exists / or replace).
-- ══════════════════════════════════════════════════════════════════════

-- ── تنظیمات ─────────────────────────────────────────────────────────────
create table if not exists public.settings (
  key   text primary key,
  value jsonb not null
);
insert into public.settings (key, value) values
  -- ایمیل‌هایی که با اولین ورود مدیر می‌شوند (ایمیل خودتان را اینجا بگذارید؛ بعداً از پنل هم می‌شود مدیر اضافه کرد)
  ('admin_emails', '["e.moeininejad@gmail.com","moeininejad.digi@gmail.com","e.moeininejad@digikala.services"]'),
  -- دموی خودکار برای هر ثبت‌نام جدید (روز؛ 0 = خاموش، فقط مدیر دمو می‌دهد)
  ('auto_trial_days', '0'),
  -- روش پرداخت: manual = درخواست و فعال‌سازی دستی توسط مدیر، zarinpal = درگاه
  ('payment_mode', '"manual"'),
  -- متنی که در حالت پرداخت دستی به خریدار نشان داده می‌شود
  ('manual_payment_note', '"درخواست شما ثبت شد. برای نهایی کردن پرداخت با پشتیبانی هماهنگ کنید؛ پس از تأیید، اشتراک فعال می‌شود."'),
  ('support_contact', '"e.moeininejad@digikala.services"')
on conflict (key) do nothing;

-- ── کاربران ─────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  avatar_url  text,
  company     text,
  phone       text,
  is_admin    boolean not null default false,
  blocked     boolean not null default false,
  note        text,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz
);

-- ── پلن‌ها ───────────────────────────────────────────────────────────────
create table if not exists public.plans (
  id             text primary key,             -- monthly | quarterly | yearly | ...
  title          text not null,
  months         int  not null check (months > 0),
  price          bigint not null check (price >= 0),        -- تومان
  compare_price  bigint,                                    -- قیمت خط‌خورده (اختیاری)
  badge          text,                                      -- «محبوب‌ترین» و مانند آن
  features       jsonb not null default '[]',
  active         boolean not null default true,
  sort           int not null default 0,
  updated_at     timestamptz not null default now()
);
insert into public.plans (id, title, months, price, compare_price, badge, features, sort) values
  ('monthly',   'یک‌ماهه',  1,  1900000, null,     null,
   '["همه شهرها و همه سازه‌ها","ایمپرشن، زمان و عمق مواجهه","قیمت و هزینه هر ایمپرشن","کمپین با بودجه و دستیار کمپین","هات‌اسپات‌ها و خروجی پیامک لوکیشن"]', 1),
  ('quarterly', 'سه‌ماهه',  3,  4900000, 5700000, 'محبوب‌ترین',
   '["همه امکانات یک‌ماهه","حدود 14٪ ارزان‌تر از ماهانه","مناسب یک فصل کمپین"]', 2),
  ('yearly',    'یک‌ساله', 12, 15900000, 22800000, 'به‌صرفه‌ترین',
   '["همه امکانات","حدود 30٪ ارزان‌تر از ماهانه","اولویت در درخواست شهر و قابلیت تازه"]', 3)
on conflict (id) do nothing;

-- ── کد تخفیف ────────────────────────────────────────────────────────────
create table if not exists public.discount_codes (
  code        text primary key,
  percent     int check (percent between 0 and 100),
  amount      bigint check (amount >= 0),          -- تخفیف ثابت به تومان (به‌جای درصد)
  plan_ids    text[],                               -- null = همه پلن‌ها
  email       text,                                 -- فقط برای این ایمیل (تخفیف شخصی)
  max_uses    int,                                  -- null = نامحدود
  used        int not null default 0,
  expires_at  timestamptz,
  active      boolean not null default true,
  note        text,
  created_at  timestamptz not null default now()
);

-- ── اشتراک‌ها (هر تمدید یک ردیف) ───────────────────────────────────────
create table if not exists public.subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  plan_id     text references public.plans(id),
  kind        text not null default 'paid' check (kind in ('paid','trial','gift')),
  status      text not null default 'active' check (status in ('active','revoked')),
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz not null,
  source      text not null default 'admin' check (source in ('admin','payment','auto_trial')),
  payment_id  uuid,
  granted_by  uuid references public.profiles(id),
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists subscriptions_user on public.subscriptions(user_id, ends_at desc);

-- ── پرداخت‌ها و درخواست‌های خرید ────────────────────────────────────────
create table if not exists public.payments (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  plan_id        text not null references public.plans(id),
  base_price     bigint not null,
  discount_code  text,
  discount       bigint not null default 0,
  amount         bigint not null,                    -- مبلغ نهایی (تومان)
  method         text not null default 'manual' check (method in ('manual','zarinpal')),
  status         text not null default 'pending' check (status in ('pending','paid','failed','cancelled')),
  authority      text,                               -- زرین‌پال
  ref_id         text,                               -- شماره پیگیری
  note           text,
  created_at     timestamptz not null default now(),
  paid_at        timestamptz
);
create index if not exists payments_user on public.payments(user_id, created_at desc);

-- ── دسترسی از پیش تعریف‌شده برای ایمیلی که هنوز ثبت‌نام نکرده ──────────
create table if not exists public.invites (
  email       text primary key,
  days        int  not null check (days > 0),
  kind        text not null default 'gift' check (kind in ('paid','trial','gift')),
  plan_id     text references public.plans(id),
  note        text,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  used_at     timestamptz
);

-- ══════════════════════════════════════════════════════════════════════
-- توابع
-- ══════════════════════════════════════════════════════════════════════
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin and not blocked from profiles where id = auth.uid()), false);
$$;

-- ساخت پروفایل با اولین ورود (+ مدیر شدن ایمیل‌های admin_emails + دموی خودکار)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  admins jsonb := coalesce((select value from settings where key = 'admin_emails'), '[]');
  trial  int   := coalesce((select (value #>> '{}')::int from settings where key = 'auto_trial_days'), 0);
begin
  insert into profiles (id, email, full_name, avatar_url, is_admin)
  values (new.id, lower(new.email),
          coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
          new.raw_user_meta_data->>'avatar_url',
          admins ? lower(new.email))
  on conflict (id) do nothing;
  if trial > 0 then
    insert into subscriptions (user_id, kind, source, ends_at, note)
    values (new.id, 'trial', 'auto_trial', now() + make_interval(days => trial), 'دموی خودکار ثبت‌نام');
  end if;
  -- دسترسی‌ای که مدیر پیش از ثبت‌نام برای این ایمیل تعریف کرده
  insert into subscriptions (user_id, plan_id, kind, source, starts_at, ends_at, granted_by, note)
  select new.id, i.plan_id, i.kind, 'admin', now(), now() + make_interval(days => i.days), i.created_by, coalesce(i.note, 'دعوت')
  from invites i where i.email = lower(new.email) and i.used_at is null;
  update invites set used_at = now() where email = lower(new.email) and used_at is null;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- برای کاربرانی که قبل از اجرای این فایل ثبت‌نام کرده‌اند
insert into public.profiles (id, email, full_name, avatar_url)
select id, lower(email), coalesce(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name'), raw_user_meta_data->>'avatar_url'
from auth.users on conflict (id) do nothing;
update public.profiles set is_admin = true
where email in (select lower(jsonb_array_elements_text(value)) from public.settings where key = 'admin_emails');

-- وضعیت دسترسی کاربر فعلی (سایت فقط همین را می‌پرسد)
create or replace function public.my_access() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p profiles; s subscriptions;
begin
  if auth.uid() is null then return jsonb_build_object('signed_in', false, 'active', false); end if;
  select * into p from profiles where id = auth.uid();
  select * into s from subscriptions
   where user_id = auth.uid() and status = 'active' and starts_at <= now() and ends_at > now()
   order by ends_at desc limit 1;
  return jsonb_build_object(
    'signed_in', true,
    'email', p.email, 'name', p.full_name, 'avatar', p.avatar_url,
    'is_admin', coalesce(p.is_admin, false), 'blocked', coalesce(p.blocked, false),
    'active', (coalesce(p.is_admin, false) or s.id is not null) and not coalesce(p.blocked, false),
    'kind', s.kind, 'plan_id', s.plan_id,
    -- پایان کل دسترسی (تمدیدهای پشت‌سرهم با هم)
    'ends_at', (select max(ends_at) from subscriptions where user_id = auth.uid() and status = 'active' and ends_at > now()),
    'had_subscription', exists(select 1 from subscriptions where user_id = auth.uid())
  );
end $$;

create or replace function public.touch_last_seen() returns void
language sql security definer set search_path = public as $$
  update profiles set last_seen = now() where id = auth.uid();
$$;

-- قیمت نهایی یک پلن با کد تخفیف (بدون ثبت چیزی؛ برای نمایش در صفحه اشتراک)
create or replace function public.quote(p_plan text, p_code text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pl plans; d discount_codes; off bigint := 0; em text; why text;
begin
  select * into pl from plans where id = p_plan and active;
  if pl.id is null then return jsonb_build_object('ok', false, 'error', 'پلن پیدا نشد'); end if;
  if coalesce(trim(p_code), '') <> '' then
    select * into d from discount_codes where upper(code) = upper(trim(p_code));
    select email into em from profiles where id = auth.uid();
    if d.code is null or not d.active then why := 'کد تخفیف معتبر نیست';
    elsif d.expires_at is not null and d.expires_at < now() then why := 'مهلت این کد تمام شده';
    elsif d.max_uses is not null and d.used >= d.max_uses then why := 'ظرفیت این کد تمام شده';
    elsif d.plan_ids is not null and not (pl.id = any(d.plan_ids)) then why := 'این کد برای این پلن نیست';
    elsif d.email is not null and lower(d.email) <> coalesce(em, '') then why := 'این کد برای حساب دیگری است';
    else
      off := least(pl.price, coalesce(d.amount, 0) + round(pl.price * coalesce(d.percent, 0) / 100.0));
    end if;
  end if;
  return jsonb_build_object('ok', true, 'plan', pl.id, 'base', pl.price, 'discount', off, 'amount', pl.price - off,
    'code', case when off > 0 then d.code end, 'code_error', why);
end $$;

-- ثبت درخواست خرید (مبلغ سمت سرور حساب می‌شود)
create or replace function public.request_subscription(p_plan text, p_code text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare q jsonb; pid uuid; mode text;
begin
  if auth.uid() is null then raise exception 'ابتدا وارد شوید'; end if;
  q := quote(p_plan, p_code);
  if not (q->>'ok')::boolean then raise exception '%', q->>'error'; end if;
  mode := coalesce((select value #>> '{}' from settings where key = 'payment_mode'), 'manual');
  -- یک درخواست باز برای هر کاربر کافی است
  update payments set status = 'cancelled' where user_id = auth.uid() and status = 'pending' and method = 'manual';
  insert into payments (user_id, plan_id, base_price, discount_code, discount, amount, method)
  values (auth.uid(), p_plan, (q->>'base')::bigint, q->>'code', (q->>'discount')::bigint, (q->>'amount')::bigint,
          case when mode = 'zarinpal' then 'zarinpal' else 'manual' end)
  returning id into pid;
  return q || jsonb_build_object('payment_id', pid, 'method', mode);
end $$;

-- فعال‌سازی یک پرداخت: اشتراک از پایان اشتراک فعلی (یا الان) ادامه پیدا می‌کند
create or replace function public.activate_payment(p_payment uuid, p_ref text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pay payments; pl plans; st timestamptz;
begin
  if not (is_admin() or coalesce(auth.role(), '') = 'service_role') then raise exception 'فقط مدیر'; end if;
  select * into pay from payments where id = p_payment for update;
  if pay.id is null then raise exception 'پرداخت پیدا نشد'; end if;
  if pay.status = 'paid' then return jsonb_build_object('ok', true, 'already', true); end if;
  select * into pl from plans where id = pay.plan_id;
  select greatest(now(), coalesce(max(ends_at), now())) into st
    from subscriptions where user_id = pay.user_id and status = 'active';
  insert into subscriptions (user_id, plan_id, kind, source, starts_at, ends_at, payment_id, granted_by, note)
  values (pay.user_id, pl.id, 'paid', case when pay.method = 'zarinpal' then 'payment' else 'admin' end,
          st, st + make_interval(months => pl.months), pay.id, auth.uid(), pay.discount_code);
  update payments set status = 'paid', paid_at = now(), ref_id = coalesce(p_ref, ref_id) where id = pay.id;
  if pay.discount_code is not null then update discount_codes set used = used + 1 where code = pay.discount_code; end if;
  return jsonb_build_object('ok', true);
end $$;

-- ── کارهای مدیر ─────────────────────────────────────────────────────────
-- دادن دسترسی: dmo/هدیه/پلن؛ از پایان دسترسی فعلی ادامه پیدا می‌کند
create or replace function public.admin_grant(p_user uuid, p_days int, p_kind text default 'gift', p_plan text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare st timestamptz;
begin
  if not is_admin() then raise exception 'فقط مدیر'; end if;
  select greatest(now(), coalesce(max(ends_at), now())) into st from subscriptions where user_id = p_user and status = 'active';
  insert into subscriptions (user_id, plan_id, kind, source, starts_at, ends_at, granted_by, note)
  values (p_user, p_plan, p_kind, 'admin', st, st + make_interval(days => p_days), auth.uid(), p_note);
  return jsonb_build_object('ok', true, 'ends_at', st + make_interval(days => p_days));
end $$;

-- دادن دسترسی با ایمیل: اگر ثبت‌نام کرده فوراً، وگرنه با اولین ورودش
create or replace function public.admin_grant_email(p_email text, p_days int, p_kind text default 'gift', p_plan text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid; em text := lower(trim(p_email));
begin
  if not is_admin() then raise exception 'فقط مدیر'; end if;
  select id into uid from profiles where email = em;
  if uid is not null then return admin_grant(uid, p_days, p_kind, p_plan, p_note) || jsonb_build_object('invited', false); end if;
  insert into invites (email, days, kind, plan_id, note, created_by) values (em, p_days, p_kind, p_plan, p_note, auth.uid())
  on conflict (email) do update set days = excluded.days, kind = excluded.kind, plan_id = excluded.plan_id, note = excluded.note, used_at = null, created_at = now();
  return jsonb_build_object('ok', true, 'invited', true);
end $$;

-- گرفتن دسترسی: همه اشتراک‌های فعال لغو می‌شوند
create or replace function public.admin_revoke(p_user uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'فقط مدیر'; end if;
  update subscriptions set status = 'revoked', note = coalesce(p_note, note) where user_id = p_user and status = 'active' and ends_at > now();
  return jsonb_build_object('ok', true);
end $$;

-- فهرست کاربران با وضعیت اشتراک
create or replace function public.admin_users() returns table (
  id uuid, email text, full_name text, avatar_url text, company text, phone text, is_admin boolean, blocked boolean, note text,
  created_at timestamptz, last_seen timestamptz, access_until timestamptz, access_kind text, plan_id text,
  paid_total bigint, pending_amount bigint, subs int
) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not is_admin() then raise exception 'فقط مدیر'; end if;
  return query
  select p.id, p.email, p.full_name, p.avatar_url, p.company, p.phone, p.is_admin, p.blocked, p.note, p.created_at, p.last_seen,
    (select max(s.ends_at) from subscriptions s where s.user_id = p.id and s.status = 'active' and s.ends_at > now()),
    (select s.kind from subscriptions s where s.user_id = p.id and s.status = 'active' and s.starts_at <= now() and s.ends_at > now() order by s.ends_at desc limit 1),
    (select s.plan_id from subscriptions s where s.user_id = p.id and s.status = 'active' and s.starts_at <= now() and s.ends_at > now() order by s.ends_at desc limit 1),
    coalesce((select sum(y.amount) from payments y where y.user_id = p.id and y.status = 'paid'), 0)::bigint,
    (select y.amount from payments y where y.user_id = p.id and y.status = 'pending' order by y.created_at desc limit 1),
    (select count(*)::int from subscriptions s where s.user_id = p.id)
  from profiles p order by p.created_at desc;
end $$;

-- ══════════════════════════════════════════════════════════════════════
-- دسترسی‌ها (Row Level Security)
-- ══════════════════════════════════════════════════════════════════════
alter table public.settings       enable row level security;
alter table public.profiles       enable row level security;
alter table public.plans          enable row level security;
alter table public.discount_codes enable row level security;
alter table public.subscriptions  enable row level security;
alter table public.payments       enable row level security;
alter table public.invites        enable row level security;
drop policy if exists "invites admin" on public.invites;
create policy "invites admin" on public.invites for all using (is_admin()) with check (is_admin());

drop policy if exists "settings read"   on public.settings;
drop policy if exists "settings admin"  on public.settings;
create policy "settings read"  on public.settings for select using (key in ('payment_mode','manual_payment_note','support_contact') or is_admin());
create policy "settings admin" on public.settings for all using (is_admin()) with check (is_admin());

drop policy if exists "profiles own"    on public.profiles;
drop policy if exists "profiles own upd" on public.profiles;
drop policy if exists "profiles admin"  on public.profiles;
create policy "profiles own"   on public.profiles for select using (id = auth.uid() or is_admin());
create policy "profiles admin" on public.profiles for all using (is_admin()) with check (is_admin());

drop policy if exists "plans read"  on public.plans;
drop policy if exists "plans admin" on public.plans;
create policy "plans read"  on public.plans for select using (active or is_admin());
create policy "plans admin" on public.plans for all using (is_admin()) with check (is_admin());

drop policy if exists "codes admin" on public.discount_codes;
create policy "codes admin" on public.discount_codes for all using (is_admin()) with check (is_admin());

drop policy if exists "subs own"   on public.subscriptions;
drop policy if exists "subs admin" on public.subscriptions;
create policy "subs own"   on public.subscriptions for select using (user_id = auth.uid() or is_admin());
create policy "subs admin" on public.subscriptions for all using (is_admin()) with check (is_admin());

drop policy if exists "pay own"   on public.payments;
drop policy if exists "pay admin" on public.payments;
create policy "pay own"   on public.payments for select using (user_id = auth.uid() or is_admin());
create policy "pay admin" on public.payments for all using (is_admin()) with check (is_admin());

-- کاربر فقط نام، شرکت و تلفن خودش را عوض می‌کند (نه مدیر بودن یا مسدودی)
create or replace function public.update_my_profile(p_name text, p_company text, p_phone text) returns void
language sql security definer set search_path = public as $$
  update profiles set full_name = nullif(trim(p_name), ''), company = nullif(trim(p_company), ''), phone = nullif(trim(p_phone), '')
  where id = auth.uid();
$$;

grant execute on function public.my_access, public.touch_last_seen, public.quote, public.request_subscription,
  public.update_my_profile, public.activate_payment, public.admin_grant, public.admin_grant_email, public.admin_revoke, public.admin_users, public.is_admin
  to authenticated;
grant execute on function public.quote to anon;
