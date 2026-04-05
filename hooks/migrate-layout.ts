#!/usr/bin/env bun
// migrate-layout.ts — Migrate vault date directory layout to the configured scheme
// Usage: bun hooks/migrate-layout.ts [--dry-run] [--plan-only] [--journal-only]

import { loadConfig } from "./lib/config.ts"
import {
  computeJournalMoves,
  computePlanMoves,
  detectVaultSchemes,
  executeMoves,
  type MoveEntry,
} from "./lib/migration.ts"

interface Args {
  dryRun: boolean
  planOnly: boolean
  journalOnly: boolean
}

function parseArgs(argv: string[]): Args {
  return {
    dryRun: argv.includes("--dry-run"),
    planOnly: argv.includes("--plan-only"),
    journalOnly: argv.includes("--journal-only"),
  }
}

function printMoves(moves: MoveEntry[], baseRel: string): void {
  for (const move of moves) {
    const from = move.from.startsWith(baseRel) ? move.from.slice(baseRel.length + 1) : move.from
    const to = move.to.startsWith(baseRel) ? move.to.slice(baseRel.length + 1) : move.to
    console.log(`  ${from}`)
    console.log(`  → ${to}`)
    console.log()
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const config = await loadConfig()

  let totalMoves = 0

  // Plan migration
  if (!args.journalOnly) {
    const planSchemes = detectVaultSchemes(config.plan.path, config.vault)
    const otherSchemes = [...planSchemes].filter((s) => s !== config.plan.date_scheme)

    if (otherSchemes.length === 0) {
      console.log(`Plans: already using '${config.plan.date_scheme}' (no migration needed)`)
    } else {
      console.log(
        `Plans: migrating ${otherSchemes.map((s) => `'${s}'`).join(", ")} → '${config.plan.date_scheme}'`,
      )

      const allMoves: MoveEntry[] = []
      for (const fromScheme of otherSchemes) {
        const moves = computePlanMoves(
          config.plan.path,
          fromScheme,
          config.plan.date_scheme,
          config.vault,
        )
        allMoves.push(...moves)
      }

      if (allMoves.length === 0) {
        console.log("  No items to move.")
      } else {
        const planCount = allMoves.filter((m) => m.type === "plan-dir").length
        const looseCount = allMoves.filter((m) => m.type === "loose").length
        const parts = [
          planCount > 0 ? `${planCount} plan dir${planCount === 1 ? "" : "s"}` : "",
          looseCount > 0 ? `${looseCount} loose item${looseCount === 1 ? "" : "s"}` : "",
        ].filter(Boolean)
        console.log(`  ${parts.join(", ")} to move:\n`)
        printMoves(allMoves, config.plan.path)

        if (!args.dryRun) {
          const moved = executeMoves(allMoves, config.vault)
          totalMoves += moved
          console.log(`  ✓ Moved ${moved} item${moved === 1 ? "" : "s"}`)
        }
      }
    }
  }

  // Journal migration
  if (!args.planOnly) {
    const journalSchemes = detectVaultSchemes(config.journal.path, config.vault)
    const otherSchemes = [...journalSchemes].filter((s) => s !== config.journal.date_scheme)

    if (otherSchemes.length === 0) {
      console.log(`Journal: already using '${config.journal.date_scheme}' (no migration needed)`)
    } else {
      console.log(
        `Journal: migrating ${otherSchemes.map((s) => `'${s}'`).join(", ")} → '${config.journal.date_scheme}'`,
      )

      const allMoves: MoveEntry[] = []
      for (const fromScheme of otherSchemes) {
        const moves = computeJournalMoves(
          config.journal.path,
          fromScheme,
          config.journal.date_scheme,
          config.vault,
        )
        allMoves.push(...moves)
      }

      if (allMoves.length === 0) {
        console.log("  No journal files to move.")
      } else {
        console.log(
          `  ${allMoves.length} journal file${allMoves.length === 1 ? "" : "s"} to move:\n`,
        )
        printMoves(allMoves, config.journal.path)

        if (!args.dryRun) {
          const moved = executeMoves(allMoves, config.vault)
          totalMoves += moved
          console.log(`  ✓ Moved ${moved} file${moved === 1 ? "" : "s"}`)
        }
      }
    }
  }

  if (args.dryRun) {
    console.log("\n(dry run — no changes made)")
  } else if (totalMoves > 0) {
    console.log(`\nDone: ${totalMoves} item${totalMoves === 1 ? "" : "s"} moved.`)
  }
}

main()
