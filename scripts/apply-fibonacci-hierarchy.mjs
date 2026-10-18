import pg from "pg";
import { readFileSync } from "node:fs";
// No environment file or implicit target. Dry run is the default.
if (!process.argv.includes("--apply"))
  console.log(
    "Prepared migration 0058. No database access. Explicit FIBONACCI_MIGRATION_DATABASE_URL and --apply required.",
  );
else {
  let client;
  try {
    const url = new URL(process.env.FIBONACCI_MIGRATION_DATABASE_URL ?? "");
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      url.hostname.includes("-pooler")
    )
      throw Error("Direct target required");
    if (!["localhost", "127.0.0.1"].includes(url.hostname))
      url.searchParams.set("sslmode", "verify-full");
    client = new pg.Client({
      connectionString: url.toString(),
      connectionTimeoutMillis: 15000,
    });
    await client.connect();
    await client.query("BEGIN");
    await client.query(
      "SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='30s'",
    );
    await client.query(
      "LOCK TABLE fibonacci_observation IN SHARE ROW EXCLUSIVE MODE",
    );
    const fingerprint = async () =>
      (
        await client.query(
          "SELECT count(*)::int n,md5(coalesce(string_agg(to_jsonb(f)::text,'' ORDER BY id),'')) hash FROM fibonacci_observation f",
        )
      ).rows[0];
    const before = await fingerprint();
    const invalid = await client.query(`
      WITH RECURSIVE paths AS (
        SELECT id::text AS origin,id::text AS current,evidence->>'parentId' AS parent,ARRAY[id::text] AS visited,false AS cycle FROM fibonacci_observation
        UNION ALL
        SELECT p.origin,o.id::text,o.evidence->>'parentId',p.visited||o.id::text,o.id::text=ANY(p.visited)
        FROM paths p JOIN fibonacci_observation o ON o.id::text=p.parent WHERE NOT p.cycle
      )
      SELECT
        (SELECT count(*)::int FROM fibonacci_observation c WHERE c.evidence->>'parentId' IS NOT NULL AND NOT EXISTS
          (SELECT 1 FROM fibonacci_observation p WHERE p.id::text=c.evidence->>'parentId' AND p."userId"=c."userId" AND p."stockId"=c."stockId")) AS invalid,
        (SELECT count(DISTINCT origin)::int FROM paths WHERE cycle) AS cycles
    `);
    if (invalid.rows[0].invalid || invalid.rows[0].cycles)
      throw Error("Existing hierarchy needs explicit correction before migration");
    await client.query(
      readFileSync(
        new URL(
          "../drizzle/0058_fibonacci_hierarchy.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const after = await fingerprint();
    if (JSON.stringify(before) !== JSON.stringify(after))
      throw Error("Stored values changed");
    await client.query("COMMIT");
    console.log(
      JSON.stringify({
        migration: "0058",
        existingValuesUnchanged: true,
        count: after.n,
      }),
    );
  } catch (e) {
    await client?.query("ROLLBACK").catch(() => {});
    console.error(
      `Hierarchy migration failed (${e.code ?? e.name}); secrets suppressed.`,
    );
    process.exitCode = 1;
  } finally {
    await client?.end().catch(() => {});
  }
}
