-- Shared test helper, created outside any transaction so every assertion file
-- can use it. Runs a statement that must be rejected, and raises if it is not.
create or replace function must_fail(stmt text, label text) returns void
language plpgsql as $$
begin
  begin
    execute stmt;
    raise exception 'constraint missing: % was accepted', label;
  exception
    when check_violation or not_null_violation or unique_violation
      or invalid_text_representation or numeric_value_out_of_range then null;
  end;
end $$;
