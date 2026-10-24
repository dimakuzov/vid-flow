#!/usr/bin/env node
// Checks and installs what the Frameboard graphs need inside a ComfyUI folder:
// model files from models.json and custom nodes from requirements-nodes.txt.
//
//   node scripts/install-comfy-assets.mjs --comfy <ComfyUI folder>             report only
//   node scripts/install-comfy-assets.mjs --comfy <ComfyUI folder> --install   download and clone what is missing
//
// Options: --only models|nodes  --yes  --dry-run  --pip  --python <exe>  --manifest <file>  --nodes <file>
// Tokens (environment): HF_TOKEN for Hugging Face, CIVITAI_TOKEN for Civitai.

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const out = { install: false, yes: false, dryRun: false, pip: false, only: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--install") out.install = true;
    else if (a === "--yes") out.yes = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--pip") out.pip = true;
    else if (a === "--comfy") out.comfy = argv[++i];
    else if (a === "--only") out.only = argv[++i];
    else if (a === "--python") out.python = argv[++i];
    else if (a === "--manifest") out.manifest = argv[++i];
    else if (a === "--nodes") out.nodes = argv[++i];
    else if (a === "-h" || a === "--help") out.help = true;
    else throw new Error(`Unknown option: ${a}`);
  }
  return out;
}

const gb = (bytes) => (bytes / 1e9).toFixed(2) + " GB";

function fileState(dest, bytes) {
  if (!fs.existsSync(dest)) return "missing";
  const size = fs.statSync(dest).size;
  if (bytes && Math.abs(size - bytes) > 1024) return "wrong-size";
  return "ok";
}

function comfyVersion(comfy) {
  try {
    const text = fs.readFileSync(path.join(comfy, "comfyui_version.py"), "utf8");
    return /__version__\s*=\s*["']([^"']+)["']/.exec(text)?.[1] ?? null;
  } catch {
    return null;
  }
}

function versionAtLeast(have, need) {
  const a = have.split(".").map((n) => parseInt(n, 10) || 0);
  const b = need.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

function tokenFor(model) {
  if (model.auth === "huggingface") return process.env.HF_TOKEN;
  if (model.auth === "civitai") return process.env.CIVITAI_TOKEN;
  return undefined;
}

function authHelp(model) {
  if (model.auth === "huggingface") {
    return `Log in to huggingface.co, open ${model.page ?? "the model page"} and accept its terms, create a read token and set HF_TOKEN.`;
  }
  if (model.auth === "civitai") {
    return "Log in to civitai.com, create an API key in your account settings and set CIVITAI_TOKEN.";
  }
  return "";
}

async function download(model, dest) {
  const part = dest + ".part";
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  let have = fs.existsSync(part) ? fs.statSync(part).size : 0;
  const token = tokenFor(model);
  let url = model.url;
  const headers = { "User-Agent": "frameboard-installer" };
  if (token && model.auth === "huggingface") headers.Authorization = `Bearer ${token}`;
  if (token && model.auth === "civitai") url += (url.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(token);
  if (have > 0) headers.Range = `bytes=${have}-`;

  const res = await fetch(url, { headers, redirect: "follow" });
  if (res.status === 401 || res.status === 403) {
    throw new Error(`${res.status}: access denied. ${authHelp(model)}`);
  }
  if (res.status === 416) {
    // the .part file already holds everything
    fs.renameSync(part, dest);
    return;
  }
  if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status} for ${model.url}`);
  if (res.status === 200 && have > 0) {
    // the server ignored Range: start over
    have = 0;
    fs.rmSync(part, { force: true });
  }
  const total = have + Number(res.headers.get("content-length") ?? 0);
  const out = fs.createWriteStream(part, { flags: have > 0 ? "a" : "w" });
  let done = have;
  let last = 0;
  for await (const chunk of res.body) {
    if (!out.write(chunk)) await new Promise((resolve) => out.once("drain", resolve));
    done += chunk.length;
    const now = Date.now();
    if (now - last > 2000) {
      last = now;
      const pct = total ? ` ${Math.round((done / total) * 100)}%` : "";
      process.stdout.write(`\r    ${gb(done)}${total ? " / " + gb(total) : ""}${pct}   `);
    }
  }
  await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
  process.stdout.write("\r" + " ".repeat(60) + "\r");
  const size = fs.statSync(part).size;
  if (model.bytes && Math.abs(size - model.bytes) > 1024) {
    throw new Error(`size ${size} differs from the expected ${model.bytes}. The partial file is kept as ${part}.`);
  }
  fs.renameSync(part, dest);
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", ...opts });
}

function readNodes(file) {
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [url, ref, folder] = line.split(/\s+/);
      if (!url || !ref || !folder) throw new Error(`Bad line in ${file}: ${line}`);
      return { url, ref, folder };
    });
}

function findPython(comfy, given) {
  if (given) return given;
  const portable = path.resolve(comfy, "..", "python_embeded", process.platform === "win32" ? "python.exe" : "bin/python");
  if (fs.existsSync(portable)) return portable;
  return process.platform === "win32" ? "python" : "python3";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.comfy) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 11).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
    process.exit(args.help ? 0 : 1);
  }
  const comfy = path.resolve(args.comfy);
  if (!fs.existsSync(path.join(comfy, "main.py")) || !fs.existsSync(path.join(comfy, "models"))) {
    throw new Error(`${comfy} does not look like a ComfyUI folder (main.py and models/ expected). Point --comfy at the folder that holds main.py.`);
  }
  const manifest = JSON.parse(fs.readFileSync(args.manifest ?? path.join(root, "models.json"), "utf8"));
  const nodesFile = args.nodes ?? path.join(root, "requirements-nodes.txt");

  const version = comfyVersion(comfy);
  const need = manifest.comfyui?.minVersion;
  console.log(`ComfyUI folder: ${comfy}`);
  console.log(`ComfyUI version: ${version ?? "unknown"}${need ? ` (needs ${need} or newer)` : ""}`);
  if (version && need && !versionAtLeast(version, need)) {
    console.log(`  WARNING: this ComfyUI is older than ${need}. Update it first, or the graphs will report missing nodes.`);
  }

  let problems = 0;
  const todoModels = [];
  const todoNodes = [];

  if (args.only !== "nodes") {
    console.log("\nModels");
    for (const m of manifest.models) {
      const dest = path.join(comfy, "models", ...m.path.split("/"));
      const state = fileState(dest, m.bytes);
      const label = state === "ok" ? "ok       " : state === "wrong-size" ? "WRONG SIZE" : "missing  ";
      console.log(`  ${label} ${gb(m.bytes).padStart(9)}  ${m.path}`);
      if (state !== "ok") {
        problems++;
        todoModels.push({ m, dest, state });
      }
    }
    const need = todoModels.reduce((sum, t) => sum + t.m.bytes, 0);
    console.log(`  ${manifest.models.length - todoModels.length} of ${manifest.models.length} present; ${gb(need)} to download`);
  }

  if (args.only !== "models") {
    console.log("\nCustom nodes");
    for (const n of readNodes(nodesFile)) {
      const dir = path.join(comfy, "custom_nodes", n.folder);
      if (fs.existsSync(dir)) console.log(`  ok        ${n.folder}`);
      else {
        console.log(`  missing   ${n.folder}  (${n.url} @ ${n.ref})`);
        problems++;
        todoNodes.push({ n, dir });
      }
    }
  }

  if (!args.install) {
    console.log(problems ? `\n${problems} item(s) missing. Run again with --install to fetch them.` : "\nEverything is in place.");
    process.exit(problems ? 2 : 0);
  }
  if (args.dryRun) {
    console.log("\nDry run: nothing downloaded or cloned.");
    process.exit(0);
  }

  if (todoNodes.length) {
    console.log("\nCloning custom nodes");
    if (run("git", ["--version"]).status !== 0) throw new Error("git is not installed or not on PATH. Install git and run this again.");
    for (const { n, dir } of todoNodes) {
      console.log(`  ${n.folder}`);
      const isCommit = /^[0-9a-f]{40}$/i.test(n.ref);
      const clone = isCommit ? run("git", ["clone", n.url, dir]) : run("git", ["clone", "--depth", "1", "--branch", n.ref, n.url, dir]);
      if (clone.status !== 0) throw new Error(`git clone failed for ${n.url}: ${clone.stderr}`);
      if (isCommit) {
        const co = run("git", ["-C", dir, "checkout", n.ref]);
        if (co.status !== 0) throw new Error(`git checkout ${n.ref} failed in ${dir}: ${co.stderr}`);
      }
      const req = path.join(dir, "requirements.txt");
      if (fs.existsSync(req) && fs.readFileSync(req, "utf8").trim()) {
        const py = findPython(comfy, args.python);
        if (args.pip) {
          console.log(`    pip install -r ${req}`);
          const r = spawnSync(py, ["-s", "-m", "pip", "install", "-r", req], { stdio: "inherit" });
          if (r.status !== 0) throw new Error(`pip failed for ${n.folder}`);
        } else {
          console.log(`    needs Python packages. Run: "${py}" -s -m pip install -r "${req}"   (or rerun with --pip)`);
        }
      }
    }
  }

  if (todoModels.length) {
    const total = todoModels.reduce((sum, t) => sum + t.m.bytes, 0);
    const free = (() => {
      try {
        const s = fs.statfsSync(comfy);
        return s.bavail * s.bsize;
      } catch {
        return null;
      }
    })();
    console.log(`\nDownloading ${todoModels.length} file(s), ${gb(total)}${free ? `, ${gb(free)} free on the drive` : ""}`);
    if (free && free < total * 1.02) throw new Error("Not enough free disk space for the downloads.");
    if (!args.yes) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = (await rl.question("Continue? [y/N] ")).trim().toLowerCase();
      rl.close();
      if (answer !== "y" && answer !== "yes") {
        console.log("Stopped.");
        process.exit(1);
      }
    }
    const failed = [];
    for (const { m, dest } of todoModels) {
      console.log(`\n${m.path}  (${gb(m.bytes)})`);
      if (!m.url) {
        console.log(`  manual download: ${m.manual ?? "open the page"}\n  ${m.page}`);
        failed.push(m.path);
        continue;
      }
      if (m.auth && !tokenFor(m)) {
        console.log(`  note: no token set. ${authHelp(m)}`);
      }
      try {
        await download(m, dest);
        console.log("  done");
      } catch (e) {
        console.log(`  FAILED: ${e.message}`);
        failed.push(m.path);
      }
    }
    if (failed.length) {
      console.log(`\n${failed.length} file(s) were not installed:\n  ${failed.join("\n  ")}`);
      process.exit(3);
    }
  }
  console.log("\nAll done. Restart ComfyUI so it sees the new nodes and files.");
}

main().catch((e) => {
  console.error("\nError: " + e.message);
  process.exit(1);
});
