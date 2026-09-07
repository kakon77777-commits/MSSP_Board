import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, "..");
const source = path.join(app, "src", "renderer");
const built = path.join(app, "dist", "renderer");
const check = process.argv.includes("--check");

async function render(target) {
  fs.mkdirSync(target, { recursive: true });
  const security = await import(`${pathToFileURL(path.join(app, "dist", "main", "security.js")).href}?t=${Date.now()}`);
  const template = fs.readFileSync(path.join(source, "index.template.html"), "utf8");
  fs.writeFileSync(path.join(target, "index.html"), template.replace("{{CSP}}", security.contentSecurityPolicy()), "utf8");
  fs.copyFileSync(path.join(source, "styles.css"), path.join(target, "styles.css"));
  fs.copyFileSync(path.join(app, "dist", "renderer", "renderer.js"), path.join(target, "renderer.js"));
}

if (!check) {
  // TypeScript already placed renderer.js in dist. Preserve it while rendering
  // the template and stylesheet around that exact artifact.
  const rendererJs = fs.readFileSync(path.join(built, "renderer.js"));
  fs.mkdirSync(built, { recursive: true });
  const security = await import(`${pathToFileURL(path.join(app, "dist", "main", "security.js")).href}?t=${Date.now()}`);
  const template = fs.readFileSync(path.join(source, "index.template.html"), "utf8");
  fs.writeFileSync(path.join(built, "index.html"), template.replace("{{CSP}}", security.contentSecurityPolicy()), "utf8");
  fs.copyFileSync(path.join(source, "styles.css"), path.join(built, "styles.css"));
  fs.writeFileSync(path.join(built, "renderer.js"), rendererJs);
} else {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "file-manager-render-check-"));
  try {
    execFileSync(process.execPath, [
      path.join(app, "node_modules", "typescript", "bin", "tsc"),
      "-p", "tsconfig.json", "--outDir", temporary,
    ], { cwd: app });
    const tempRenderer = path.join(temporary, "renderer");
    const security = await import(`${pathToFileURL(path.join(temporary, "main", "security.js")).href}?t=${Date.now()}`);
    const template = fs.readFileSync(path.join(source, "index.template.html"), "utf8");
    fs.writeFileSync(path.join(tempRenderer, "index.html"), template.replace("{{CSP}}", security.contentSecurityPolicy()), "utf8");
    fs.copyFileSync(path.join(source, "styles.css"), path.join(tempRenderer, "styles.css"));
    for (const name of ["index.html", "renderer.js", "styles.css"]) {
      const expected = fs.readFileSync(path.join(tempRenderer, name));
      const actual = fs.readFileSync(path.join(built, name));
      if (!expected.equals(actual)) throw new Error(`stale built renderer: dist/renderer/${name}`);
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
