// Verknüpft Trades ohne Instrument nachträglich.
//
// Nutzung (aus dem Projektordner):
//   node node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/cli.mjs scripts/link-trades.ts --dry
//   node node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/cli.mjs scripts/link-trades.ts
//
// Ohne `--dry` wird geschrieben. Bestehende Zuordnungen bleiben unangetastet.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

function loadEnv() {
  const here = dirname(fileURLToPath(import.meta.url))
  let raw = ''
  try {
    raw = readFileSync(join(here, '..', '.env.local'), 'utf8')
  } catch {
    return
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

loadEnv()

if (!process.env.DATABASE_URL) {
  console.error('FEHLER: DATABASE_URL fehlt.')
  process.exit(1)
}

const dry = process.argv.includes('--dry')

async function main() {
  const { linkLooseTrades } = await import('../lib/link-trades.js')
  const { describeLinkReason } = await import('../lib/instrument-link.js')

  const report = await linkLooseTrades({ dryRun: dry })

  console.log(dry ? '\n=== PROBELAUF — es wird nichts geschrieben ===' : '\n=== Verknüpfung ===')
  console.log(`Trades ohne Instrument: ${report.checked}`)
  console.log(`${dry ? 'Würden verknüpft' : 'Verknüpft'}:        ${report.linked}\n`)

  for (const a of report.attempts) {
    const mark = a.stockId ? '✓' : '✗'
    const ziel = a.stockId ? `→ ${a.instrumentTicker} (#${a.stockId})` : '→ —'
    const via = a.viaSymbol ? `  [über ${a.viaSymbol}]` : ''
    console.log(
      `${mark} Trade #${String(a.tradeId).padEnd(4)} „${a.ticker}“`.padEnd(38) +
        `${ziel.padEnd(24)}${describeLinkReason(a.reason)}${via}`,
    )
  }
  process.exit(0)
}

main().catch((err) => {
  console.error('FEHLER:', err)
  process.exit(1)
})
