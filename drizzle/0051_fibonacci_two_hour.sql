-- Add the user's two-hour research interval; no observation values are rewritten.
ALTER TABLE fibonacci_observation DROP CONSTRAINT IF EXISTS fib_timeframe;
ALTER TABLE fibonacci_observation ADD CONSTRAINT fib_timeframe
 CHECK (timeframe IN ('5m','15m','30m','1h','2h','4h','1d','1w','1M','unbekannt'));
