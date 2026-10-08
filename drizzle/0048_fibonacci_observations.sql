CREATE TABLE IF NOT EXISTS fibonacci_observation (
 id uuid PRIMARY KEY,
 "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 "stockId" integer NOT NULL REFERENCES stock(id) ON DELETE CASCADE,
 wave text NOT NULL CHECK (wave IN ('2','4','A','B','C','X','Y')),
 degree text NOT NULL CHECK (degree IN ('GrandSupercycle','Supercycle','Zyklus','Primär','Intermediär','Minor','Minute','Minuette','Subminuette')),
 timeframe text NOT NULL CHECK (timeframe IN ('5m','15m','30m','1h','4h','1d','1w','1M')),
 "observedOn" text NOT NULL CHECK ("observedOn" = to_char("observedOn"::date, 'YYYY-MM-DD') AND "observedOn" ~ '^\d{4}-\d{2}-\d{2}$'),
 status text NOT NULL CHECK (status IN ('laufend','abgeschlossen','ungueltig')),
 percent double precision NOT NULL CHECK (percent >= 0 AND percent <= 500),
 "anchorStart" double precision, "anchorEnd" double precision, extreme double precision,
 note text NOT NULL CHECK (length(trim(note)) BETWEEN 1 AND 2000),
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 "createdAt" timestamp NOT NULL DEFAULT now(), "updatedAt" timestamp NOT NULL DEFAULT now(),
 CHECK (("anchorStart" IS NULL AND "anchorEnd" IS NULL AND extreme IS NULL) OR
 ("anchorStart" IS NOT NULL AND "anchorEnd" IS NOT NULL AND extreme IS NOT NULL AND
 "anchorStart" > 0 AND "anchorEnd" > 0 AND extreme > 0 AND
 "anchorStart" < 'Infinity'::double precision AND "anchorEnd" < 'Infinity'::double precision AND extreme < 'Infinity'::double precision AND "anchorStart" <> "anchorEnd" AND
 abs(percent - ("anchorEnd"-extreme)/("anchorEnd"-"anchorStart")*100) <= 0.01))
);
CREATE INDEX IF NOT EXISTS fibonacci_owner_instrument ON fibonacci_observation ("userId", "stockId", "observedOn");
