CREATE TABLE IF NOT EXISTS daily_sheet_check_in (
  user_id text PRIMARY KEY,
  check_in_day date NOT NULL,
  answers smallint[] NOT NULL DEFAULT '{}',
  states smallint[] NOT NULL DEFAULT '{}'
);
