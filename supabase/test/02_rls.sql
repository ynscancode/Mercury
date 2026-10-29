-- Row-level security assertions. Every statement that must fail is wrapped so
-- the script fails loudly if it unexpectedly succeeds.
\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

-- Seed one task for each user, as that user, through RLS.
set local role authenticated;
set local daybook.test_user_id = '11111111-1111-1111-1111-111111111111';
insert into tasks (user_id, title) values
  ('11111111-1111-1111-1111-111111111111', 'Alice task');

set local daybook.test_user_id = '22222222-2222-2222-2222-222222222222';
insert into tasks (user_id, title) values
  ('22222222-2222-2222-2222-222222222222', 'Bob task');

-- 1. A user sees only their own rows.
set local daybook.test_user_id = '11111111-1111-1111-1111-111111111111';
do $$
declare n integer;
begin
  select count(*) into n from tasks;
  if n <> 1 then
    raise exception 'RLS leak: Alice sees % tasks, expected 1', n;
  end if;
  select count(*) into n from tasks where title = 'Bob task';
  if n <> 0 then
    raise exception 'RLS leak: Alice can read Bob''s task';
  end if;
end $$;

-- 2. A user cannot update another user's row.
do $$
declare n integer;
begin
  update tasks set title = 'hijacked' where title = 'Bob task';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'RLS leak: Alice updated % of Bob''s rows', n;
  end if;
end $$;

-- 3. A user cannot delete another user's row.
do $$
declare n integer;
begin
  delete from tasks where title = 'Bob task';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'RLS leak: Alice deleted % of Bob''s rows', n;
  end if;
end $$;

-- 4. A user cannot insert a row owned by someone else.
do $$
begin
  begin
    insert into tasks (user_id, title)
      values ('22222222-2222-2222-2222-222222222222', 'forged');
    raise exception 'RLS leak: Alice inserted a task owned by Bob';
  exception
    when insufficient_privilege then null;
  end;
end $$;

reset role;
rollback;
