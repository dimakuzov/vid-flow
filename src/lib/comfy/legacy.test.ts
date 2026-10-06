// Сверка до/после (бриф 3): prompt по манифестам совпадает с тем, что собирал старый stage-run.ts.
// fixtures/legacy-prompts.json снят старым кодом на кадрах из fixtures/legacy-cases.ts; seed обнулены.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

// Сверка проверяет раннер, а не текущие плейбуки: графы берутся живые, а манифесты — снимок
// из ветки contracts (fixtures/legacy-manifests), когда они повторяли старый stage-run.ts.
// Бриф 4 потом перенёс обвязку текста в шаблоны prompt.md, живые манифесты от этого изменились.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-legacy-"));
process.env.DATA_ROOT = tmp;
process.env.PLAYBOOKS_ROOT = path.join(tmp, "playbooks");
{
  const comfy = path.join(process.env.PLAYBOOKS_ROOT, "workflows", "comfy");
  fs.cpSync(path.resolve(__dirname, "../../../playbooks"), process.env.PLAYBOOKS_ROOT, { recursive: true });
  for (const name of fs.readdirSync(comfy).filter((file) => file.endsWith(".bind.json"))) {
    fs.rmSync(path.join(comfy, name));
  }
  fs.cpSync(path.join(__dirname, "fixtures", "legacy-manifests"), comfy, { recursive: true });
}
process.env.COMFY_URL = "http://127.0.0.1:9";
process.env.FRAMEBOARD_LOOPS = "off";
delete process.env.SERIES_ROOT;

import { EP, LEGACY_CASES, normalizeJob, setupLegacyCases } from "./fixtures/legacy-cases";
import { readComfyJob } from "./queue";
import { queueStageRun } from "./stage-run";

const expected = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "legacy-prompts.json"), "utf8"),
) as Record<string, unknown>;
const comfyDir = path.join(process.env.PLAYBOOKS_ROOT, "workflows", "comfy");

before(() => setupLegacyCases());
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

for (const item of LEGACY_CASES) {
  test(`как раньше: ${item.name}`, () => {
    const queued = queueStageRun(EP, item.shotId, item.stageId, { workflow: item.workflow });
    const job = readComfyJob(queued.id)!;
    const manifest = JSON.parse(fs.readFileSync(path.join(comfyDir, `${job.workflow}.bind.json`), "utf8"));
    const graph = JSON.parse(fs.readFileSync(path.join(comfyDir, manifest.graph), "utf8"));
    assert.deepEqual(normalizeJob(job, tmp, graph), expected[item.name]);
    for (const node of Object.values(job.prompt)) {
      for (const key of ["seed", "noise_seed"]) {
        const value = node.inputs[key];
        if (typeof value === "number") assert.ok(Number.isInteger(value) && value >= 0, "seed — целое");
      }
    }
  });
}
