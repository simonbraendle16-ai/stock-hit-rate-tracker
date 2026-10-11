import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({ database: null as any }));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.database;
  },
}));
import * as schema from "./db/schema";
import { saveFib, listFib, getFib } from "./fibonacci-service";
import {
  saveHistory,
  getHistory,
  listHistory,
} from "./fibonacci-history-service";
import { GET as contextGET } from "@/app/api/assistant/v1/fibonacci/context/route";
import { hashToken } from "./assistant-api";
import { GET, POST } from "@/app/api/assistant/v1/fibonacci/route";
import {
  GET as detailGET,
  PATCH,
} from "@/app/api/assistant/v1/fibonacci/[id]/route";
let pg: PGlite;
const input = {
  stockId: 1,
  wave: "B",
  degree: "Minor",
  timeframe: "1d",
  observedOn: "2026-01-01",
  status: "abgeschlossen",
  percent: 50,
  anchorStart: 100,
  anchorEnd: 200,
  extreme: 150,
  note: "Synthetic source",
};
const tokens = {
  owner: "sat_" + "a".repeat(43),
  other: "sat_" + "b".repeat(43),
  read: "sat_" + "c".repeat(43),
};
beforeAll(async () => {
  pg = new PGlite();
  state.database = drizzle(pg, { schema });
  await pg.exec(`CREATE TABLE "user" (id text PRIMARY KEY);INSERT INTO "user" VALUES ('owner'),('other');
 CREATE TABLE stock(id serial PRIMARY KEY,"userId" text NOT NULL,name text NOT NULL,ticker text NOT NULL,market text NOT NULL);
 INSERT INTO stock VALUES (1,'owner','Synthetic stock','TEST','aktien'),(2,'other','Foreign','FOREIGN','krypto');
 CREATE TABLE trade(id integer PRIMARY KEY,"userId" text,"stockId" integer);
 INSERT INTO trade VALUES (10,'owner',1),(20,'other',2);
 CREATE TABLE assistant_api_token(id uuid DEFAULT gen_random_uuid(),"userId" text,name text DEFAULT 'Synthetic token',"createdAt" timestamp DEFAULT now(),"tokenHash" text,scopes jsonb,"revokedAt" timestamp,"lastUsedAt" timestamp);`);
  await pg.exec(
    readFileSync(
      new URL("../drizzle/0048_fibonacci_observations.sql", import.meta.url),
      "utf8",
    ),
  );
  await pg.exec(
    readFileSync(
      new URL("../drizzle/0049_fibonacci_research.sql", import.meta.url),
      "utf8",
    ),
  );
  await pg.exec(
    readFileSync(
      new URL("../drizzle/0050_fibonacci_history.sql", import.meta.url),
      "utf8",
    ),
  );
  for (const [key, value] of Object.entries(tokens))
    await pg.query(
      'INSERT INTO assistant_api_token ("userId","tokenHash",scopes) VALUES ($1,$2,$3)',
      [
        key === "other" ? "other" : "owner",
        hashToken(value),
        JSON.stringify(
          key === "read" ? ["trades:read"] : ["trades:read", "trades:write"],
        ),
      ],
    );
}, 30000);
afterAll(async () => {
  await pg?.close();
});
beforeEach(async () => {
  await pg.exec(
    "TRUNCATE fibonacci_revision, fibonacci_observation, fibonacci_history",
  );
});
const request = (
  path: string,
  token: string | null = tokens.owner,
  method = "GET",
  body?: object,
  extra: Record<string, string> = {},
) =>
  new NextRequest("http://localhost/api/assistant/v1/fibonacci" + path, {
    method,
    headers: {
      ...(token ? { authorization: "Bearer " + token } : {}),
      "Content-Type": "application/json",
      ...extra,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
describe("Fibonacci isolated PostgreSQL and HTTP contract", () => {
  it("applies additive migration twice without changing instrument rows", async () => {
    await pg.exec(
      readFileSync(
        new URL("../drizzle/0048_fibonacci_observations.sql", import.meta.url),
        "utf8",
      ),
    );
    expect(
      (await pg.query("SELECT count(*)::int AS n FROM stock")).rows,
    ).toEqual([{ n: 2 }]);
  });
  it("saves, rereads, retries safely and rejects another body on same ID", async () => {
    const id = crypto.randomUUID();
    const first = await saveFib("owner", id, input);
    expect(first.version).toBe(1);
    expect((await getFib("owner", id)).percent).toBe(50);
    await saveFib("owner", id, input);
    expect(await listFib("owner")).toHaveLength(1);
    await expect(
      saveFib("owner", id, { ...input, note: "Different" }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("enforces ownership in lists, detail, create and update", async () => {
    const id = crypto.randomUUID();
    await saveFib("owner", id, input);
    expect(await listFib("other")).toEqual([]);
    await expect(getFib("other", id)).rejects.toMatchObject({ status: 404 });
    await expect(
      saveFib("owner", crypto.randomUUID(), { ...input, stockId: 2 }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      saveFib("other", id, { ...input, stockId: 2 }, 1),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("allows one optimistic update and rejects stale versions", async () => {
    const id = crypto.randomUUID();
    await saveFib("owner", id, input);
    const changed = await saveFib(
      "owner",
      id,
      { ...input, status: "laufend" },
      1,
    );
    expect(changed.version).toBe(2);
    await expect(saveFib("owner", id, input, 1)).rejects.toMatchObject({
      status: 409,
    });
    expect((await getFib("owner", id)).status).toBe("laufend");
  });
  it("checks percent and anchor consistency at database boundary", async () => {
    for (const percent of [-1, 501, NaN])
      await expect(
        pg.query(
          "INSERT INTO fibonacci_observation(id,\"userId\",\"stockId\",wave,degree,timeframe,\"observedOn\",status,percent,note) VALUES ($1,'owner',1,'B','Minor','1d','2026-01-01','abgeschlossen',$2,'Synthetic')",
          [crypto.randomUUID(), percent],
        ),
      ).rejects.toThrow();
    await expect(
      pg.query(
        "INSERT INTO fibonacci_observation(id,\"userId\",\"stockId\",wave,degree,timeframe,\"observedOn\",status,percent,note,\"anchorStart\",\"anchorEnd\",extreme) VALUES ($1,'owner',1,'B','Minor','1d','2026-01-01','abgeschlossen',70,'Synthetic',100,200,150)",
        [crypto.randomUUID()],
      ),
    ).rejects.toThrow();
  });
  it("enforces auth, scopes, body validation and missing keys over HTTP", async () => {
    expect((await GET(request("", null))).status).toBe(401);
    expect(
      (
        await POST(
          request("", tokens.read, "POST", input, {
            "Idempotency-Key": crypto.randomUUID(),
          }),
        )
      ).status,
    ).toBe(403);
    expect((await POST(request("", tokens.owner, "POST", input))).status).toBe(
      400,
    );
    expect(
      (
        await POST(
          request(
            "",
            tokens.owner,
            "POST",
            { ...input, percent: 70 },
            { "Idempotency-Key": crypto.randomUUID() },
          ),
        )
      ).status,
    ).toBe(422);
  });
  it("creates through API and paginates without limiting summary denominator", async () => {
    for (const n of [38.2, 61.8, 100])
      await POST(
        request(
          "",
          tokens.owner,
          "POST",
          {
            ...input,
            percent: n,
            anchorStart: null,
            anchorEnd: null,
            extreme: null,
          },
          { "Idempotency-Key": crypto.randomUUID() },
        ),
      );
    const result = await GET(request("?limit=1"));
    const body = await result.json();
    expect(result.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.total).toBe(3);
    expect(body.stats.n).toBe(3);
    expect(body.nextOffset).toBe(1);
    expect((await GET(request("?market=krypto"))).status).toBe(200);
    expect((await (await GET(request("?market=krypto"))).json()).total).toBe(0);
    expect((await GET(request("?limit=-1"))).status).toBe(400);
    expect((await GET(request("?wave=unknown"))).status).toBe(200);
    expect((await GET(request("?wave="))).status).toBe(400);
    expect((await GET(request("?from=2026-02-02&to=2026-01-01"))).status).toBe(
      400,
    );
    expect((await GET(request("?from=2026-02-30"))).status).toBe(400);
  });
  it("GET/PATCH roundtrip protects foreign records and versions", async () => {
    const id = crypto.randomUUID(),
      ctx = { params: Promise.resolve({ id }) };
    await saveFib("owner", id, input);
    expect((await detailGET(request("/" + id, tokens.other), ctx)).status).toBe(
      404,
    );
    expect(
      (
        await PATCH(
          request("/" + id, tokens.owner, "PATCH", input, {
            "X-Expected-Version": "1",
          }),
          ctx,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await PATCH(
          request("/" + id, tokens.owner, "PATCH", input, {
            "X-Expected-Version": "1",
          }),
          ctx,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await PATCH(
          request("/" + id, tokens.read, "PATCH", input, {
            "X-Expected-Version": "2",
          }),
          ctx,
        )
      ).status,
    ).toBe(403);
  });
  it("migrates the complete research bundle repeatedly, preserving custom constraints", async () => {
    await pg.exec(
      "ALTER TABLE fibonacci_observation ADD CONSTRAINT custom_note_guard CHECK (length(note)>0)",
    );
    for (const file of [
      "0049_fibonacci_research.sql",
      "0050_fibonacci_history.sql",
      "0049_fibonacci_research.sql",
      "0050_fibonacci_history.sql",
    ])
      await pg.exec(
        readFileSync(new URL("../drizzle/" + file, import.meta.url), "utf8"),
      );
    expect(
      (
        await pg.query(
          "SELECT conname FROM pg_constraint WHERE conname='custom_note_guard'",
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("upgrades a real legacy observation preserving identity, anchors, version and revision", async () => {
    const legacy = new PGlite();
    try {
      await legacy.exec(`CREATE TABLE "user"(id text PRIMARY KEY); INSERT INTO "user" VALUES ('owner');
        CREATE TABLE stock(id integer PRIMARY KEY,"userId" text); INSERT INTO stock VALUES(1,'owner');
        CREATE TABLE trade(id integer PRIMARY KEY,"userId" text,"stockId" integer);`);
      const migration = (name: string) => readFileSync(new URL('../drizzle/' + name, import.meta.url), 'utf8');
      await legacy.exec(migration('0048_fibonacci_observations.sql'));
      const id = crypto.randomUUID();
      await legacy.query(`INSERT INTO fibonacci_observation(id,"userId","stockId",wave,degree,timeframe,"observedOn",status,percent,"anchorStart","anchorEnd",extreme,note,version) VALUES($1,'owner',1,'B','Minor','1d','2026-01-01','abgeschlossen',50,100,200,150,'Legacy source',3)`,[id]);
      const before = (await legacy.query('SELECT id,percent,"anchorStart","anchorEnd",extreme,note,version FROM fibonacci_observation')).rows;
      for (const file of ['0049_fibonacci_research.sql','0050_fibonacci_history.sql','0049_fibonacci_research.sql','0050_fibonacci_history.sql']) await legacy.exec(migration(file));
      expect((await legacy.query('SELECT id,percent,"anchorStart","anchorEnd",extreme,note,version FROM fibonacci_observation')).rows).toEqual(before);
      expect((await legacy.query('SELECT "contextId", "measurementKind" FROM fibonacci_observation')).rows).toEqual([{contextId:id,measurementKind:'retracement'}]);
      expect((await legacy.query('SELECT version FROM fibonacci_revision')).rows).toEqual([{version:3}]);
    } finally { await legacy.close(); }
  });
  it("reports ambiguous contexts and refuses implicit association", async () => {
    const base = {...input,periodFrom:'2025-12-01',periodTo:'2025-12-31'};
    for (let i=0;i<2;i++) await saveFib('owner',crypto.randomUUID(),{...base,contextId:crypto.randomUUID()});
    const response = await contextGET(request('?instrument=TEST&wave=B'));
    const resolved = await response.json();
    expect(resolved.resolution).toBe('mehrdeutig');
    expect(resolved.contexts).toHaveLength(2);
    await expect(saveFib('owner',crypto.randomUUID(),base)).rejects.toMatchObject({status:409});
    expect(await listFib('owner')).toHaveLength(2);
  });
  it("stores immutable user-owned history, retries content, links and protects foreign data", async () => {
    const body = {
      stockId: 1,
      interval: "1d",
      timezone: "UTC",
      currency: "EUR",
      source: "Synthetic",
      origin: "csv" as const,
      candles: [
        {
          time: 1767225600,
          open: 100,
          high: 120,
          low: 90,
          close: 110,
          volume: 0,
        },
      ],
    };
    const saved = await saveHistory("owner", crypto.randomUUID(), body);
    expect((await saveHistory("owner", crypto.randomUUID(), body)).id).toBe(
      saved.id,
    );
    expect((await getHistory("owner", saved.id)).coverage.count).toBe(1);
    expect(await listHistory("other")).toHaveLength(0);
    await expect(getHistory("other", saved.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      saveHistory("other", crypto.randomUUID(), body),
    ).rejects.toMatchObject({ status: 404 });
    const id = crypto.randomUUID();
    await saveFib("owner", id, { ...input, historyId: saved.id, tradeId: 10 });
    expect((await getFib("owner", id)).historyId).toBe(saved.id);
    await expect(
      saveFib("owner", crypto.randomUUID(), { ...input, tradeId: 20 }),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      (
        (await pg.query("SELECT count(*)::int n FROM fibonacci_history"))
          .rows[0] as { n: number }
      ).n,
    ).toBe(1);
  });
  it("shares a context across measurement kinds, counts one each and preserves expansion rules on legacy PATCH", async () => {
    const id = crypto.randomUUID();
    await saveFib("owner", id, input);
    const expansionId = crypto.randomUUID();
    const expansion = {
      ...input,
      anchorStart: null,
      anchorEnd: null,
      extreme: null,
      percent: 600,
      measurementKind: "expansion",
      measurementBasis: "Relative to first impulse",
      contextId: id,
    };
    await saveFib("owner", expansionId, expansion);
    const response = await (await GET(request(""))).json();
    expect(response.statsByKind.retracement.n).toBe(1);
    expect(response.statsByKind.expansion.n).toBe(1);
    await expect(
      saveFib("owner", expansionId, { ...input, percent: 50 }, 1),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      saveFib("owner", crypto.randomUUID(), {
        ...expansion,
        stockId: 1,
        wave: "C",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("resolves two kinds of one wave context as the same candidate", async () => {
    const id = crypto.randomUUID();
    await saveFib("owner", id, input);
    await saveFib("owner", crypto.randomUUID(), {
      ...input,
      anchorStart: null,
      anchorEnd: null,
      extreme: null,
      measurementKind: "expansion",
      measurementBasis: "Synthetic reference",
      contextId: id,
    });
    const resolved = await (
      await contextGET(request("?instrument=TEST&wave=B"))
    ).json();
    expect(resolved.resolution).toBe("eindeutig");
    expect(resolved.contexts).toHaveLength(1);
  });

  it("automatically associates a unique fully specified period and retries structured variants", async () => {
    const base = {
      ...input,
      periodFrom: "2025-12-01",
      periodTo: "2025-12-31",
      stopVariants: [
        {
          label: "Box",
          description: "1 % unter Box",
          kind: "hypothetisch",
          outcome: "verlust",
          resultR: -1,
        },
      ],
    };
    const first = await saveFib("owner", crypto.randomUUID(), base);
    expect((await saveFib("owner", crypto.randomUUID(), base)).id).toBe(
      first.id,
    );
    const expansion = await saveFib("owner", crypto.randomUUID(), {
      ...base,
      anchorStart: null,
      anchorEnd: null,
      extreme: null,
      measurementKind: "expansion",
      measurementBasis: "First impulse",
      percent: 161.8,
    });
    expect(expansion.contextId).toBe(first.contextId);
    expect((await listFib("owner")).length).toBe(2);
    const revisions = await pg.query(
      'SELECT version FROM fibonacci_revision WHERE "observationId"=$1',
      [first.id],
    );
    expect(revisions.rows).toHaveLength(1);
  });

  it("serializes parallel repeated writes without duplicate waves", async () => {
    const contextId = crypto.randomUUID();
    const results = await Promise.all([
      saveFib("owner", crypto.randomUUID(), { ...input, contextId }),
      saveFib("owner", crypto.randomUUID(), { ...input, contextId }),
    ]);
    expect(results[0].id).toBe(results[1].id);
    expect(await listFib("owner")).toHaveLength(1);
  });
});
