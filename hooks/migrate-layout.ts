#!/usr/bin/env bun
// migrate-layout.ts — Migrate vault date directory layout to the configured scheme
// Usage: bun hooks/migrate-layout.ts [--dry-run] [--plan-only] [--journal-only]

import { join } from "node:path";
import { loadConfig } from "./lib/config.ts";
import {
  cleanEmptyDirs,
  computeJournalMoves,
  computePlanMoves,
  detectVaultSchemes,
  executeMoves,
  type MoveEntry,
} from "./lib/migration.ts";
import { getVaultPath } from "./lib/obsidian.ts";

interface Args {
  dryRun: boolean;
  planOnly: boolean;
  journalOnly: boolean;
}

function parseArgs(argv: string[]): Args {
  return {
    dryRun: argv.includes("--dry-run"),
    planOnly: argv.includes("--plan-only"),
    journalOnly: argv.includes("--journal-only"),
  };
}

function printMoves(moves: MoveEntry[], basePath: string): void {
  for (const move of moves) {
    const from = move.from.replace(basePath, "").replace(/^\//, "");
    const to = move.to.replace(basePath, "").replace(/^\//, "");
    console.log(`  ${from}`);
    console.log(`  → ${to}`);
    console.log();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = await loadConfig();
  const vaultPath = getVaultPath(config.vault);

  if (!vaultPath) {
    console.error("Error: Cannot resolve vault path. Check your capture-plan.toml config.");
    process.exit(1);
  }

  let totalMoves = 0;
  let totalCleaned = 0;

  // Plan migration
  if (!args.journalOnly) {
    const planBase = join(vaultPath, config.plan.path);
    const planSchemes = detectVaultSchemes(planBase);
    const otherSchemes = [...planSchemes].filter((s) => s !== config.plan.date_scheme);

    if (otherSchemes.length === 0) {
      console.log(`Plans: already using '${config.plan.date_scheme}' (no migration needed)`);
    } else {
      console.log(
        `Plans: migrating ${otherSchemes.map((s) => `'${s}'`).join(", ")} → '${config.plan.date_scheme}'`,
      );

      const allMoves: MoveEntry[] = [];
      for (const fromScheme of otherSchemes) {
        const moves = computePlanMoves(planBase, fromScheme, config.plan.date_scheme);
        allMoves.push(...moves);
      }

      if (allMoves.length === 0) {
        console.log("  No items to move.");
      } else {
        const planCount = allMoves.filter((m) => m.type === "plan-dir").length;
        const looseCount = allMoves.filter((m) => m.type === "loose").length;
        const parts = [
          planCount > 0 ? `${planCount} plan dir${planCount === 1 ? "" : "s"}` : "",
          looseCount > 0 ? `${looseCount} loose item${looseCount === 1 ? "" : "s"}` : "",
        ].filter(Boolean);
        console.log(`  ${parts.join(", ")} to move:\n`);
        printMoves(allMoves, vaultPath);

        if (!args.dryRun) {
          const moved = executeMoves(allMoves, vaultPath, config.vault);
          const fromPaths = allMoves.map((m) => m.from);
          const cleaned = cleanEmptyDirs(fromPaths, planBase);
          totalMoves += moved;
          totalCleaned += cleaned;
          console.log(
            `  ✓ Moved ${moved} item${moved === 1 ? "" : "s"}, cleaned ${cleaned} empty dir${cleaned === 1 ? "" : "s"}`,
          );
        }
      }
    }
  }

  // Journal migration
  if (!args.planOnly) {
    const journalBase = join(vaultPath, config.journal.path);
    const journalSchemes = detectVaultSchemes(journalBase);
    const otherSchemes = [...journalSchemes].filter((s) => s !== config.journal.date_scheme);

    if (otherSchemes.length === 0) {
      console.log(`Journal: already using '${config.journal.date_scheme}' (no migration needed)`);
    } else {
      console.log(
        `Journal: migrating ${otherSchemes.map((s) => `'${s}'`).join(", ")} → '${config.journal.date_scheme}'`,
      );

      const allMoves: MoveEntry[] = [];
      for (const fromScheme of otherSchemes) {
        const moves = computeJournalMoves(journalBase, fromScheme, config.journal.date_scheme);
        allMoves.push(...moves);
      }

      if (allMoves.length === 0) {
        console.log("  No journal files to move.");
      } else {
        console.log(
          `  ${allMoves.length} journal file${allMoves.length === 1 ? "" : "s"} to move:\n`,
        );
        printMoves(allMoves, vaultPath);

        if (!args.dryRun) {
          const moved = executeMoves(allMoves, vaultPath, config.vault);
          const fromPaths = allMoves.map((m) => m.from);
          const cleaned = cleanEmptyDirs(fromPaths, journalBase);
          totalMoves += moved;
          totalCleaned += cleaned;
          console.log(
            `  ✓ Moved ${moved} file${moved === 1 ? "" : "s"}, cleaned ${cleaned} empty dir${cleaned === 1 ? "" : "s"}`,
          );
        }
      }
    }
  }

  if (args.dryRun) {
    console.log("\n(dry run — no changes made)");
  } else if (totalMoves > 0) {
    console.log(
      `\nDone: ${totalMoves} item${totalMoves === 1 ? "" : "s"} moved, ${totalCleaned} empty dir${totalCleaned === 1 ? "" : "s"} removed.`,
    );
  }
}

main();
