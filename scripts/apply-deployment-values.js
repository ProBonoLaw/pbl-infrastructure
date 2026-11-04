#!/usr/bin/env node
// Swaps the placeholder identifiers in this repository for the real values of
// one deployment (or back again). Placeholders are the fake subscription,
// tenant, principal and assignment GUIDs, the 203.0.113.x addresses, and the
// "testsuffix"/"prodsuffix" resource-name suffixes.
//
//   node scripts/apply-deployment-values.js [values.json]            apply
//   node scripts/apply-deployment-values.js [values.json] --reverse  restore placeholders
//   node scripts/apply-deployment-values.js --list                   list placeholders in use
//
// values.json maps placeholder -> real value (see deployment-values.example.json).
// Defaults to deployment-values.json, or the DEPLOYMENT_VALUES env var (JSON).
// Edits happen in the working tree only; never commit real values to a public repo.
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

const args = process.argv.slice(2);
const reverse = args.includes("--reverse");
const list = args.includes("--list");
const valuesFile = args.find((a) => !a.startsWith("--")) ?? "deployment-values.json";

const PLACEHOLDER =
  /00000000-0000-4000-8000-[0-9a-f]{12}|203\.0\.113\.1[5-9]\d|\b(?:test|prod)suffix(?:001)?/g;
const SKIP = /^(sdks\/|package-lock\.json$|LICENSE$|deployment-values)/;

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 28 })
  .split("\0")
  .filter((f) => f && !SKIP.test(f));

function read(file) {
  const buffer = fs.readFileSync(file);
  return buffer.includes(0) ? undefined : buffer.toString("utf8");
}

if (list) {
  const seen = new Map();
  for (const file of files) {
    const text = read(file);
    if (text === undefined) continue;
    text.split("\n").forEach((line, i) => {
      for (const [p] of line.matchAll(PLACEHOLDER)) {
        if (!seen.has(p)) seen.set(p, []);
        seen.get(p).push(`${file}:${i + 1}`);
      }
    });
  }
  for (const [p, where] of [...seen].sort()) console.log(`${p}\t${where.slice(0, 3).join(", ")}${where.length > 3 ? ` (+${where.length - 3})` : ""}`);
  process.exit(0);
}

let raw = process.env.DEPLOYMENT_VALUES;
if (!raw) {
  if (!fs.existsSync(valuesFile)) {
    console.error(`No values: ${valuesFile} not found and DEPLOYMENT_VALUES is unset.`);
    process.exit(1);
  }
  raw = fs.readFileSync(valuesFile, "utf8");
}
let pairs = Object.entries(JSON.parse(raw)).filter(([k]) => !k.startsWith("_"));
if (reverse) pairs = pairs.map(([k, v]) => [v, k]);
if (new Set(pairs.map(([k]) => k)).size !== pairs.length) throw new Error("duplicate source values in mapping");
if (!reverse) {
  const unresolved = pairs.filter(([, v]) => !v || /^REPLACE/i.test(v));
  if (unresolved.length) throw new Error(`${unresolved.length} placeholders have no real value, e.g. ${unresolved[0][0]}`);
}
const map = new Map(pairs);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`);
const pattern = new RegExp(
  [...map.keys()].sort((a, b) => b.length - a.length).map(escape).join("|"),
  "gi",
);

let changed = 0;
for (const file of files) {
  const text = read(file);
  if (text === undefined) continue;
  const next = text.replace(pattern, (m) => map.get(m) ?? map.get(m.toLowerCase()) ?? m);
  if (next !== text) {
    fs.writeFileSync(file, next);
    changed++;
  }
}
console.log(`${reverse ? "Restored placeholders in" : "Applied deployment values to"} ${changed} files.`);
