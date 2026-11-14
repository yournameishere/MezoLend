// Prints the README table of production E2E transactions from one or more e2e log files.
//   node readme-table.mjs ../deployments/e2e-prod-run1.json ../deployments/e2e-prod-log.json
import { readFileSync } from "node:fs";

const files = process.argv.slice(2);
const rows = [];
const seen = new Set();
for (const f of files) {
  const log = JSON.parse(readFileSync(f, "utf8"));
  for (const s of log.steps) {
    if (!s.ok || seen.has(s.name)) continue;
    seen.add(s.name);
    const txs = s.transactions ?? [];
    rows.push(
      `| ${s.name.replace(/\|/g, "/")} | ${txs.length ? txs.map((t) => `[${t.hash.slice(0, 10)}…](${t.url})`).join(", ") : "no transaction (UI check)"} | ${txs.length ? txs.map((t) => t.explorer).join(", ") : "n/a"} |`,
    );
  }
}
console.log("| UI action on mezolend.vercel.app | Transaction | Explorer status |\n| --- | --- | --- |");
console.log(rows.join("\n"));
