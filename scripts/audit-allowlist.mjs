// CI security gate: fail on new high/critical advisories, while
// allowlisting known vulnerabilities that have no fix available
// upstream.
//
// Remove an entry once a fixed version exists and the lockfile is
// updated; keep the list as short as possible.
import { execFileSync } from "node:child_process";
import process from "node:process";

const ALLOWED = [
  {
    package: "extract-zip",
    advisory: "GHSA-jmr9-qjv8-65gv",
    reason:
      "Dev-only packaging tool (dependency of @electron/packager). No " +
      "patched version exists (all versions <= 2.0.1 are vulnerable). " +
      "Revisit once upstream ships a fix.",
  },
];

function leafAdvisories(name, report, seen = new Set()) {
  const info = report.vulnerabilities?.[name];
  if (!info || seen.has(name)) return [];
  seen.add(name);
  const leaves = [];
  for (const via of info.via ?? []) {
    if (typeof via === "string") {
      leaves.push(...leafAdvisories(via, report, seen));
    } else if (via.name || via.url) {
      const match = /GHSA-[0-9a-z-]+/.exec(via.url ?? "");
      leaves.push({
        package: via.name ?? via.dependency ?? name,
        advisory: match?.[0] ?? via.title ?? "unknown",
      });
    }
  }
  return leaves;
}

let report;
try {
  const raw = execFileSync("npm", ["audit", "--audit-level=high", "--json"], {
    encoding: "utf8",
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  report = JSON.parse(raw);
} catch (error) {
  try {
    report = JSON.parse(String(error.stdout ?? ""));
  } catch {
    console.error(String(error.stderr ?? error).slice(0, 4000));
    process.exit(1);
  }
}

const counts = report.metadata?.vulnerabilities ?? {};
const blocking = [];
for (const [name, info] of Object.entries(report.vulnerabilities ?? {})) {
  if (info.severity !== "high" && info.severity !== "critical") continue;
  const leaves = leafAdvisories(name, report);
  if (leaves.length === 0) {
    blocking.push(`${name}: unknown advisory (severity: ${info.severity})`);
    continue;
  }
  const unapproved = leaves.filter(
    (leaf) =>
      !ALLOWED.some(
        (entry) =>
          entry.package === leaf.package && entry.advisory === leaf.advisory,
      ),
  );
  if (unapproved.length > 0) {
    blocking.push(
      `${name}: ${unapproved.map((l) => `${l.package}/${l.advisory}`).join(", ")}`,
    );
  } else {
    const [first] = leaves;
    console.log(
      `allowed  ${name} (via ${first.package} [${first.advisory}], severity: ${info.severity})`,
    );
  }
}

console.log(
  `audit: ${counts.info ?? 0} info, ${counts.low ?? 0} low, ` +
    `${counts.moderate ?? 0} moderate, ${counts.high ?? 0} high, ` +
    `${counts.critical ?? 0} critical`,
);

if (blocking.length > 0) {
  for (const line of blocking) console.error(`blocking ${line}`);
  console.error("npm audit found unapproved high/critical advisories.");
  process.exit(1);
}
