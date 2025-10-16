-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- =====================================================
-- PROFILES TABLE (extends auth.users for user data)
-- =====================================================
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text unique not null,
  full_name text,
  avatar_url text,
  plan text default 'free' check (plan in ('free', 'pro', 'enterprise')),
  credits int default 3,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security
alter table public.profiles enable row level security;

-- Profiles policies
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- =====================================================
-- PRESENTATIONS TABLE (save user presentations)
-- =====================================================
create table public.presentations (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  title text not null,
  html_content text,
  pdf_name text,
  thumbnail_url text,
  status text default 'draft' check (status in ('draft', 'processing', 'completed', 'failed')),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security
alter table public.presentations enable row level security;

-- Presentations policies
create policy "Users can view own presentations"
  on public.presentations for select
  using (auth.uid() = user_id);

create policy "Users can insert own presentations"
  on public.presentations for insert
  with check (auth.uid() = user_id);

create policy "Users can update own presentations"
  on public.presentations for update
  using (auth.uid() = user_id);

create policy "Users can delete own presentations"
  on public.presentations for delete
  using (auth.uid() = user_id);

-- =====================================================
-- CHAT_MESSAGES TABLE (save conversation history)
-- =====================================================
create table public.chat_messages (
  id uuid default uuid_generate_v4() primary key,
  presentation_id uuid references public.presentations(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security
alter table public.chat_messages enable row level security;

-- Chat messages policies
create policy "Users can view own chat messages"
  on public.chat_messages for select
  using (auth.uid() = user_id);

create policy "Users can insert own chat messages"
  on public.chat_messages for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own chat messages"
  on public.chat_messages for delete
  using (auth.uid() = user_id);

-- =====================================================
-- SUBSCRIPTIONS TABLE (Stripe payment tracking)
-- =====================================================
create table public.subscriptions (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  stripe_price_id text,
  status text check (status in ('active', 'canceled', 'past_due', 'trialing', 'incomplete')),
  current_period_start timestamp with time zone,
  current_period_end timestamp with time zone,
  cancel_at_period_end boolean default false,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security
alter table public.subscriptions enable row level security;

-- Subscriptions policies
create policy "Users can view own subscription"
  on public.subscriptions for select
  using (auth.uid() = user_id);

-- =====================================================
-- USAGE_LOGS TABLE (track credit usage)
-- =====================================================
create table public.usage_logs (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  action text not null,
  credits_used int default 1,
  presentation_id uuid references public.presentations(id) on delete set null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security
alter table public.usage_logs enable row level security;

-- Usage logs policies
create policy "Users can view own usage logs"
  on public.usage_logs for select
  using (auth.uid() = user_id);

create policy "Users can insert own usage logs"
  on public.usage_logs for insert
  with check (auth.uid() = user_id);

-- =====================================================
-- FUNCTIONS
-- =====================================================

-- Function to automatically update updated_at timestamp
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- =====================================================
-- TRIGGERS
-- =====================================================

-- Trigger for profiles updated_at
create trigger on_profiles_updated
  before update on public.profiles
  for each row execute procedure public.handle_updated_at();

-- Trigger for presentations updated_at
create trigger on_presentations_updated
  before update on public.presentations
  for each row execute procedure public.handle_updated_at();

-- Trigger for subscriptions updated_at
create trigger on_subscriptions_updated
  before update on public.subscriptions
  for each row execute procedure public.handle_updated_at();

-- Trigger to automatically create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$ language plpgsql security definer;

-- Trigger on auth.users for auto profile creation
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- =====================================================
-- INDEXES for performance
-- =====================================================

create index presentations_user_id_idx on public.presentations(user_id);
create index chat_messages_presentation_id_idx on public.chat_messages(presentation_id);
create index chat_messages_user_id_idx on public.chat_messages(user_id);
create index subscriptions_user_id_idx on public.subscriptions(user_id);
create index subscriptions_stripe_customer_id_idx on public.subscriptions(stripe_customer_id);
create index usage_logs_user_id_idx on public.usage_logs(user_id);
create index usage_logs_created_at_idx on public.usage_logs(created_at);
