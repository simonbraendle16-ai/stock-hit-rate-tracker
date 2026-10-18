-- Preserve every row and revision; relax only the two obsolete requirements.
ALTER TABLE fibonacci_observation DROP CONSTRAINT IF EXISTS fib_note;
ALTER TABLE fibonacci_observation DROP CONSTRAINT IF EXISTS fibonacci_observation_note_check;
ALTER TABLE fibonacci_observation DROP CONSTRAINT IF EXISTS fib_expansion;
ALTER TABLE fibonacci_observation
  ADD CONSTRAINT fib_note CHECK (length(note) <= 2000);
ALTER TABLE fibonacci_observation ALTER COLUMN note SET DEFAULT '';
