const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const CONTENT_DIR = path.join(ROOT, "content_packs");
const MOJIBAKE_PATTERN = /(Ã.|Â.|â.|ðŸ|ï¿½)/;

function collectJsonFiles(dir, options = {}) {
  const { excludeDirs = new Set(), excludeFiles = new Set() } = options;

  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!excludeDirs.has(entry.name.toLowerCase())) {
        files.push(...collectJsonFiles(fullPath, options));
      }
      continue;
    }

    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".json")) continue;
    if (excludeFiles.has(entry.name.toLowerCase())) continue;
    files.push(fullPath);
  }

  return files;
}

function looksCorrupted(value) {
  return typeof value === "string" && MOJIBAKE_PATTERN.test(value);
}

function repairString(value) {
  if (!looksCorrupted(value)) {
    return value;
  }

  return Buffer.from(value, "latin1").toString("utf8");
}

function walk(node, visitor) {
  if (Array.isArray(node)) {
    return node.map((item) => walk(item, visitor));
  }

  if (node && typeof node === "object") {
    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => [key, walk(value, visitor)])
    );
  }

  return visitor(node);
}

let changedFiles = 0;

for (const filePath of collectJsonFiles(CONTENT_DIR)) {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);
  const repaired = walk(parsed, repairString);
  const next = JSON.stringify(repaired, null, 2) + "\n";

  if (next !== raw) {
    fs.writeFileSync(filePath, next, "utf8");
    changedFiles += 1;
    console.log(`Fixed ${path.relative(CONTENT_DIR, filePath)}`);
  }
}

console.log(`Repaired ${changedFiles} content pack file(s).`);
