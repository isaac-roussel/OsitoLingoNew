const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const CONTENT_DIR = path.join(ROOT, "content_packs");
const MOJIBAKE_PATTERN = /(Ã.|Â.|â.|ðŸ|ï¿½)/;
const offenders = [];

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

function walk(node, filePath, trail = []) {
  if (Array.isArray(node)) {
    node.forEach((value, index) => walk(value, filePath, [...trail, index]));
    return;
  }

  if (node && typeof node === "object") {
    Object.entries(node).forEach(([key, value]) => walk(value, filePath, [...trail, key]));
    return;
  }

  if (typeof node === "string" && MOJIBAKE_PATTERN.test(node)) {
    offenders.push({ filePath, field: trail.join("."), value: node });
  }
}

for (const filePath of collectJsonFiles(CONTENT_DIR)) {
  const raw = fs.readFileSync(filePath, "utf8");
  walk(JSON.parse(raw), path.relative(CONTENT_DIR, filePath));
}

if (offenders.length > 0) {
  console.error("Found possible mojibake in content packs:");
  offenders.slice(0, 50).forEach((item) => {
    console.error(`- ${item.filePath} :: ${item.field} :: ${item.value}`);
  });
  process.exit(1);
}

console.log("Content pack encoding check passed.");
