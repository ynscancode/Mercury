-- Capacity-model constraints.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email)
  values ('55555555-5555-5555-5555-555555555555', 'cap@example.com');
insert into calendar_accounts (id, user_id, provider)
  values ('66666666-6666-6666-6666-666666666666',
          '55555555-5555-5555-5555-555555555555', 'icloud_caldav');

-- A fraction is a fraction.
select must_fail($$
  insert into calendar_events (user_id, account_id, provider_uid, starts_at, ends_at, usable_fraction)
  values ('55555555-5555-5555-5555-555555555555',
          '66666666-6666-6666-6666-666666666666', 'u1',
          now(), now() + interval '1 hour', 1.5)
$$, 'usable_fraction above 1');

select must_fail($$
  insert into calendar_events (user_id, account_id, provider_uid, starts_at, ends_at, usable_fraction)
  values ('55555555-5555-5555-5555-555555555555',
          '66666666-6666-6666-6666-666666666666', 'u2',
          now(), now() + interval '1 hour', -0.1)
$$, 'negative usable_fraction');

-- A capacity factor of zero would make every day impossible rather than
-- conservative, so the floor is deliberate.
select must_fail($$
  insert into settings (user_id, capacity_factor)
  values ('55555555-5555-5555-5555-555555555555', 0)
$$, 'capacity_factor of zero');

select must_fail($$
  insert into settings (user_id, long_event_hours)
  values ('55555555-5555-5555-5555-555555555555', 0)
$$, 'long_event_hours of zero');

-- Defaults preserve the artifact's behaviour: a timed event blocks fully.
insert into calendar_events (user_id, account_id, provider_uid, starts_at, ends_at)
  values ('55555555-5555-5555-5555-555555555555',
          '66666666-6666-6666-6666-666666666666', 'u3',
          now(), now() + interval '1 hour');
do $$
declare f numeric;
begin
  select usable_fraction into f from calendar_events where provider_uid = 'u3';
  if f <> 0 then raise exception 'timed events should block fully by default, got %', f; end if;
end $$;

rollback;
