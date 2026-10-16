// Local-only end-to-end QA. Requires fibonacci-local-preview and the private QA browser.
// Both HTTP and SQL targets are fixed loopback addresses; never load a production env file.
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
const toolRequire = createRequire(
  join(process.env.APPDATA, "npm/node_modules/browser-use/package.json"),
);
const { chromium } = toolRequire("playwright");
const { Client } = createRequire(new URL("../package.json", import.meta.url))(
  "pg",
);
const db = new Client({
  connectionString: "postgresql://postgres:postgres@127.0.0.1:5548/postgres",
});
const state = JSON.parse(
  await readFile(join(tmpdir(), "fibonacci-browser-2026-10-06.json"), "utf8"),
);
const browser = await chromium.connectOverCDP(state.cdp_url);
const page = browser
  .contexts()[0]
  .pages()
  .find((p) => p.url().startsWith("http://localhost:3018"));
const select = async (label, value, scope = page) => {
  await scope.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: value, exact: true }).click();
};
const output = resolve(".test-tools/research-ui-results");
await mkdir(output, { recursive: true });
const results = [];
const pass = (name) => {
  results.push(name);
  console.log("PASS " + name);
};
const marker = "QA-RUNDLAUF-" + Date.now();
try {
  await db.connect();
  assert.equal(
    (
      await db.query('SELECT email FROM "user" WHERE id=$1', [
        "fibonacci-local-qa",
      ])
    ).rows[0]?.email,
    "fibonacci-qa@example.invalid",
  );
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto("http://localhost:3018/analysis");
  if (page.url().includes("/sign-in")) {
    await page
      .getByLabel("E-Mail", { exact: true })
      .fill("fibonacci-qa@example.invalid");
    await page
      .getByLabel("Passwort", { exact: true })
      .fill("Local-Fibonacci-QA-2026!");
    await page.getByRole("button", { name: "Anmelden", exact: true }).click();
    await page.waitForURL((url) => !url.pathname.includes("sign-in"), {
      timeout: 60000,
    });
  }
  await page.goto("http://localhost:3018/analysis");
  await page
    .getByRole("tab", { name: /Messprotokoll/ })
    .waitFor({ timeout: 60000 });
  pass("authenticated real application loads against local synthetic database");
  await select("Instrument", "FIBQA-S · Synthetische Aktie");
  await select("Welle", "4");
  await select("Zeiteinheit", "2h");
  await page
    .getByRole("button", { name: "Neue Beobachtung", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await select("Wellenstatus", "Abgeschlossen", dialog);
  await select("Messmethode", "Aus Referenzankern berechnen", dialog);
  await dialog.getByLabel("Anfang der Referenz", { exact: true }).fill("100");
  await dialog.getByLabel("Ende der Referenz", { exact: true }).fill("200");
  await dialog.getByLabel("Beobachtetes Extrem", { exact: true }).fill("138.2");
  await dialog
    .getByLabel("Quelle / Referenz", { exact: true })
    .fill("Isolierter UI-Testchart");
  await dialog.getByLabel("Zeitraum von", { exact: true }).fill("2026-10-01");
  await dialog.getByLabel("Zeitraum bis", { exact: true }).fill("2026-10-15");
  await dialog
    .getByLabel("Messnotiz / Quelle", { exact: true })
    .fill(marker + " synthetische Welle und Quelle, keine realen Marktdaten.");
  const title = await dialog.locator("[data-slot=dialog-title]").boundingBox(),
    save = await dialog
      .getByRole("button", { name: "Speichern", exact: true })
      .boundingBox(),
    box = await dialog.boundingBox();
  assert(
    title.y >= box.y &&
      save.y >= box.y &&
      save.y + save.height <= box.y + box.height,
  );
  await dialog.getByRole("button", { name: "Speichern", exact: true }).click();
  await dialog.waitFor({ state: "hidden", timeout: 30000 });
  await page
    .getByRole("searchbox", { name: "Beobachtungen durchsuchen", exact: true })
    .fill(marker);
  await page.getByRole("table").getByText("61,8 %", { exact: true }).waitFor();
  let rows = (
    await db.query(
      'SELECT id,version,percent,"stockId",wave,timeframe,"sourceRef","periodFrom","periodTo" FROM fibonacci_observation WHERE "userId"=$1 AND note LIKE $2',
      ["fibonacci-local-qa", marker + "%"],
    )
  ).rows;
  assert.equal(rows.length, 1);
  const id = rows[0].id;
  assert.equal(rows[0].version, 1);
  assert(Math.abs(rows[0].percent - 61.8) < 1e-8);
  assert.equal(rows[0].stockId, 1);
  assert.equal(rows[0].wave, "4");
  assert.equal(rows[0].timeframe, "2h");
  assert.equal(rows[0].sourceRef, "Isolierter UI-Testchart");
  pass(
    "browser save, readback, exact source/context and filtered population agree on one case",
  );
  await page
    .getByRole("button", { name: /Messung FIBQA-S .* bearbeiten/ })
    .filter({ visible: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Beobachtetes Extrem", { exact: true }).fill("150");
  await dialog.getByRole("button", { name: "Speichern", exact: true }).click();
  await dialog.waitFor({ state: "hidden", timeout: 30000 });
  await page.getByRole("table").getByText("50 %", { exact: true }).waitFor();
  rows = (
    await db.query(
      'SELECT id,version,percent,"sourceRef","periodFrom","periodTo" FROM fibonacci_observation WHERE "userId"=$1 AND note LIKE $2',
      ["fibonacci-local-qa", marker + "%"],
    )
  ).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, id);
  assert.equal(rows[0].version, 2);
  assert.equal(rows[0].percent, 50);
  assert.equal(rows[0].sourceRef, "Isolierter UI-Testchart");
  assert.equal(rows[0].periodFrom, "2026-10-01");
  assert.equal(rows[0].periodTo, "2026-10-15");
  assert.match(
    await page.getByLabel("Datenbasis der aktuellen Auswahl").innerText(),
    /50 %/,
  );
  pass(
    "versioned browser correction updates the same case and its statistic, preserving source and period",
  );
  await page.getByRole("tab", { name: "Messprotokoll 1", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await page
    .getByRole("tab", { name: "Verteilungen", exact: true, selected: true })
    .waitFor();
  await page.getByRole("tab", { name: /Messprotokoll/ }).click();
  pass("tabs can be operated with keyboard arrows");
  for (const width of [390, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page
      .getByRole("button", { name: "Auswahl zurücksetzen", exact: true })
      .first()
      .click();
    await page
      .getByRole("link", { name: "01 · Wellenforschung", exact: true })
      .click();
    await page.waitForTimeout(200);
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    if (width === 390)
      await page.screenshot({ path: join(output, "mobile-top.png") });
    for (const name of [
      "Verteilungen",
      "Strukturen & Stops",
      "Tradebezug",
      "Kursdaten",
    ]) {
      await page.getByRole("tab", { name, exact: true }).click();
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        name + " " + width,
      );
    }
    await page.getByRole("tab", { name: /Messprotokoll/ }).click();
    if (width < 768) {
      const first = page.locator("article:visible").first();
      await first.scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(output, `cards-${width}.png`) });
      await first.getByRole("button", { name: /bearbeiten/ }).click();
      dialog = page.getByRole("dialog");
      await dialog.waitFor();
      await dialog.getByLabel("Messnotiz / Quelle", { exact: true }).focus();
      const header = await dialog
          .locator("[data-slot=dialog-title]")
          .boundingBox(),
        footer = await dialog
          .getByRole("button", { name: "Speichern", exact: true })
          .boundingBox(),
        bounds = await dialog.boundingBox();
      await page.waitForTimeout(250);
      const stableFooter = await dialog
        .getByRole("button", { name: "Speichern", exact: true })
        .boundingBox();
      assert(header.y >= bounds.y);
      assert(stableFooter.y >= bounds.y);
      assert(stableFooter.y + stableFooter.height <= bounds.y + bounds.height);
      assert(
        await dialog
          .getByRole("button", { name: "Speichern", exact: true })
          .evaluate((el) => {
            const r = el.getBoundingClientRect();
            const target = document.elementFromPoint(
              r.x + r.width / 2,
              r.y + r.height / 2,
            );
            return target === el || el.contains(target);
          }),
      );
      if (width === 390)
        await page.screenshot({ path: join(output, "mobile-form.png") });
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
    }
    pass(
      `real app at ${width}px: all five views fit; edit dialog retains visible title and actions`,
    );
  }
  assert.equal(
    (
      await db.query("SELECT version FROM fibonacci_observation WHERE id=$1", [
        id,
      ])
    ).rows[0].version,
    2,
  );
  pass(
    "opening, inspecting and cancelling never mutates the saved observation",
  );
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto("http://localhost:3018/analysis#fibonacci");
  await page.getByRole("tab", { name: /Messprotokoll/ }).waitFor();
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(output, "desktop.png") });
  await writeFile(
    join(output, "results.json"),
    JSON.stringify(
      { at: new Date().toISOString(), localOnly: true, results },
      null,
      2,
    ) + "\n",
  );
} finally {
  await db.end();
  await browser.close();
}
