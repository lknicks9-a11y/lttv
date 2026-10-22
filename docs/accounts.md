# LTTV accounts (sign in with email, Google or Apple)

LTTV keeps each person's playlists, guides, favorites, teams, bets, Continue watching and settings
with their account, so every TV, phone or computer they sign in on has them. Accounts live in **your
own Supabase project** (free plan). Nothing is shared with anyone else.

## 1. Create the project (about 5 minutes)

1. Sign up at <https://supabase.com> and create a **New project** (Free plan).
2. Open **Project Settings → API**. Copy the **Project URL** and the **anon public** key into
   `src/app/cloud-config.ts` (or send them to Claude). The anon key is meant to be public: what each user
   can read and write is enforced by the database rules below.

## 2. Create the table (SQL Editor → New query → Run)

```sql
create table if not exists public.lttv_profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.lttv_profiles enable row level security;

-- Each person can only see and change their own row.
create policy "read own"   on public.lttv_profiles for select using (auth.uid() = user_id);
create policy "insert own" on public.lttv_profiles for insert with check (auth.uid() = user_id);
create policy "update own" on public.lttv_profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own" on public.lttv_profiles for delete using (auth.uid() = user_id);
```

## 3. Sign-in settings (Authentication)

- **Providers → Email**: on (default). "Confirm email" can stay on (people confirm from their inbox
  once) or be turned off for instant sign-up.
- **URL Configuration → Redirect URLs**: add `http://**` (the TV's phone sign-in page runs on your home
  network, e.g. `http://192.168.1.20:8787/signin`) and, for the desktop app, `http://localhost:8787/**`.
- **Providers → Google** (optional, free): create an OAuth client in Google Cloud Console
  (APIs & Services → Credentials → OAuth client ID → Web application), add the callback URL Supabase
  shows (`https://<project>.supabase.co/auth/v1/callback`) as an authorized redirect URI, then paste the
  client ID and secret into Supabase.
- **Providers → Apple** (optional): needs an Apple Developer Program membership ($99/year) to create a
  Services ID and key; follow Supabase's Apple guide.

## How it works

- **TV**: Sign in → "Sign in with your phone" shows a QR code. The phone opens a page served by the TV
  on the home network, signs in (Google, Apple or email) and hands the TV a sign-in token (PIN-checked,
  never logged). The TV keeps its own sign-in and stays signed in.
- **First sign-in**: the account is empty, so LTTV asks for the playlist / provider login and guide.
  They're saved to the account a few seconds later.
- **Another device**: signing in brings the playlists, guides, favorites, teams and settings down and
  loads the channels. Changes made anywhere are saved back within a few seconds (and every 5 minutes).
- Provider logins and playlist addresses are stored in your project's `lttv_profiles` table, readable
  only by the signed-in owner (row level security).
