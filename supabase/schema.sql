-- ============================================================
-- 作业分类与任务分发系统 —— Supabase 数据库结构
-- 在 Supabase 控制台：SQL Editor → 粘贴本文件全部内容 → Run
-- ============================================================

-- ---------- 1. 用户档案表 ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  username text,
  display_name text,
  role text not null default 'student' check (role in ('student','teacher')),
  created_at timestamptz not null default now()
);
-- 已建过表的老项目跑这一句补齐 username 列
alter table public.profiles add column if not exists username text;

-- 新用户注册后自动创建档案（默认学生）
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, username, display_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'username', new.email),
    coalesce(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'username', new.email),
    'student'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 2. 分类规则 ----------
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  rules text not null default '',
  created_at timestamptz not null default now()
);

-- ---------- 3. 学生上传的文件 ----------
create table if not exists public.uploads (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  filename text not null,
  storage_path text not null,
  size bigint,
  mime text,
  category_id uuid references public.categories(id) on delete set null,
  classified_by text,               -- 'ai' | 'teacher' | null
  status text not null default 'new',
  created_at timestamptz not null default now()
);

-- ---------- 4. 任务 ----------
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  category_id uuid references public.categories(id) on delete set null,  -- null = 默认任务
  attachment_path text,
  attachment_name text,
  created_at timestamptz not null default now()
);

-- ---------- 5. 任务分配 ----------
create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null references public.uploads(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending',   -- pending | submitted | done
  assigned_by text,                          -- 'ai' | 'teacher'
  created_at timestamptz not null default now()
);

-- ---------- 6. 索引 ----------
create index if not exists idx_uploads_student on public.uploads(student_id);
create index if not exists idx_uploads_category on public.uploads(category_id);
create index if not exists idx_assignments_student on public.assignments(student_id);
create index if not exists idx_assignments_upload on public.assignments(upload_id);

-- ---------- 7. 存储桶（文件上传用，公开读） ----------
insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', true)
on conflict (id) do nothing;

-- ============================================================
-- RLS（行级安全）
-- ============================================================
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.uploads enable row level security;
alter table public.tasks enable row level security;
alter table public.assignments enable row level security;

-- 辅助：当前用户是否是老师
create or replace function public.is_teacher()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'teacher');
$$;

-- profiles：本人可读，老师可读全部；老师可改角色
create policy "profiles_select" on public.profiles for select using (id = auth.uid() or public.is_teacher());
create policy "profiles_update" on public.profiles for update to authenticated using (public.is_teacher()) with check (public.is_teacher());

-- categories：登录用户可读（学生上传列表要显示分类名，匿名读不到）；老师可增删改
drop policy if exists "categories_select" on public.categories;
create policy "categories_select" on public.categories for select to authenticated using (true);
create policy "categories_insert" on public.categories for insert to authenticated with check (public.is_teacher());
create policy "categories_update" on public.categories for update to authenticated using (public.is_teacher()) with check (public.is_teacher());
create policy "categories_delete" on public.categories for delete to authenticated using (public.is_teacher());

-- uploads：学生只能上传/查看自己的，老师可查看全部、改分类、删除
create policy "uploads_select" on public.uploads for select using (student_id = auth.uid() or public.is_teacher());
create policy "uploads_insert" on public.uploads for insert to authenticated with check (student_id = auth.uid());
create policy "uploads_update" on public.uploads for update to authenticated using (public.is_teacher()) with check (public.is_teacher());
create policy "uploads_delete" on public.uploads for delete to authenticated using (public.is_teacher());

-- tasks：老师可读全部；学生只能读分配给自己的任务；匿名读不到；老师可增删改
drop policy if exists "tasks_select" on public.tasks;
create policy "tasks_select" on public.tasks for select to authenticated
using (
  public.is_teacher()
  or exists (
    select 1 from public.assignments a
    where a.task_id = tasks.id and a.student_id = auth.uid()
  )
);
create policy "tasks_insert" on public.tasks for insert to authenticated with check (public.is_teacher());
create policy "tasks_update" on public.tasks for update to authenticated using (public.is_teacher()) with check (public.is_teacher());
create policy "tasks_delete" on public.tasks for delete to authenticated using (public.is_teacher());

-- assignments：学生可查看/改自己的状态，老师可全部操作
create policy "assignments_select" on public.assignments for select using (student_id = auth.uid() or public.is_teacher());
create policy "assignments_insert" on public.assignments for insert to authenticated with check (public.is_teacher());
create policy "assignments_update" on public.assignments for update to authenticated using (student_id = auth.uid() or public.is_teacher()) with check (student_id = auth.uid() or public.is_teacher());
create policy "assignments_delete" on public.assignments for delete to authenticated using (public.is_teacher());

-- storage：公开读，登录用户可上传
create policy "storage_public_read" on storage.objects for select using (bucket_id = 'uploads');
create policy "storage_auth_insert" on storage.objects for insert to authenticated with check (bucket_id = 'uploads');
create policy "storage_auth_delete" on storage.objects for delete to authenticated using (bucket_id = 'uploads');

-- ============================================================
-- 老师身份激活（任选其一执行）
-- ============================================================
-- 方式一：把「老师」的账号替换后执行（推荐，简单）
-- update public.profiles set role = 'teacher' where username = '老师账号';
