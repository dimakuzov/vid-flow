// Comfy Cloud (HeyGen): только с разрешением, загрузка → отправка один раз → опрос → скачивание.
// Поддельный сервер облака на localhost; настоящий манифест и граф, данные во временной DATA_ROOT.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-cloud-"));
process.env.DATA_ROOT = tmp;
process.env.PLAYBOOKS_ROOT = path.resolve(__dirname, "../../../playbooks");
process.env.COMFY_URL = "http://127.0.0.1:9";
process.env.FRAMEBOARD_LOOPS = "off";
process.env.COMFY_CLOUD_API_KEY = "test-key";
delete process.env.SERIES_ROOT;

import { createEpisode, ensureStageDirs, shotDir, stageDir } from "../series/paths";
import { listWorkflowChoices } from "./workflows";
import { drainComfyQueue, readComfyJob } from "./queue";
import { queueStageRun } from "./stage-run";

const EP = "e01";
const PNG = Buffer.from("89504e470d0a1a0a", "hex");

type Seen = { method: string; url: string; key?: string; body?: string };
const seen: Seen[] = [];
let jobStatus = "in_progress";
let server: http.Server;

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const url = req.url || "";
      seen.push({ method: req.method || "", url, key: req.headers["x-api-key"] as string | undefined, body });
      const json = (code: number, data: unknown) => {
        res.writeHead(code, { "Content-Type": "application/json" });
        res.end(JSON.stringify(data));
      };
      if (url === "/api/upload/image") return json(200, { name: "abc123hash.png", subfolder: "" });
      if (url === "/api/prompt") return json(200, { prompt_id: "11111111-2222-3333-4444-555555555555" });
      if (url.startsWith("/api/jobs/")) {
        return json(200, {
          status: jobStatus,
          outputs: jobStatus === "completed" ? { "3": { images: [{ filename: "s01_heygen_00001_.mp4", subfolder: "", type: "output" }] } } : undefined,
        });
      }
      if (url.startsWith("/api/view")) {
        res.writeHead(302, { Location: `http://127.0.0.1:${(server.address() as AddressInfo).port}/signed/file.mp4` });
        return res.end();
      }
      if (url === "/signed/file.mp4") {
        res.writeHead(200, { "Content-Type": "video/mp4" });
        return res.end("fake mp4 bytes");
      }
      json(404, { error: "not found" });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.COMFY_CLOUD_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  createEpisode(EP);
  fs.mkdirSync(shotDir(EP, "s01"), { recursive: true });
  fs.writeFileSync(path.join(shotDir(EP, "s01"), "shot.md"), "# s01\n\n- characters: julia, lena\n- location: park\n");
  fs.writeFileSync(path.join(shotDir(EP, "s01"), "speech.md"), "Julia: I like fantasy.\nLena: I've lost my diary!\n");
  ensureStageDirs(EP, "s01");
  fs.writeFileSync(path.join(stageDir(EP, "s01", "first_frame"), "approve", "ff.png"), PNG);
  fs.writeFileSync(
    path.join(stageDir(EP, "s01", "final_render"), "prompt.md"),
    'On the left is Julia. Julia says: "I like fantasy." On the right is Lena. Lena says: "I\'ve lost my diary!" Audio: wind. No music.',
  );
});

after(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("диалог двух говорящих — по умолчанию HeyGen, вариант помечен как облачный с ценой", () => {
  const choices = listWorkflowChoices(EP, "s01", "final_render");
  const heygen = choices.find((choice) => choice.id === "final_heygen")!;
  assert.equal(heygen.isDefault, true);
  assert.deepEqual(heygen.cloud, { credits: 45.3, perSeconds: 10 });
  assert.equal(choices.find((choice) => choice.id === "final_wan_720")!.cloud, null);
});

test("без разрешения облачный запуск не ставится и в облако ничего не уходит", () => {
  assert.throws(() => queueStageRun(EP, "s01", "final_render"), /Разрешить платную отправку в Comfy Cloud/);
  assert.equal(seen.length, 0);
});

test("с разрешением: загрузка, одна отправка с ключом, опрос, скачивание по подписанной ссылке", async () => {
  const queued = queueStageRun(EP, "s01", "final_render", { allowCloud: true });
  let job = readComfyJob(queued.id)!;
  assert.equal(job.target, "cloud");
  const seed = job.prompt["9"].inputs["model.seed"] as number;
  assert.ok(seed >= 0 && seed <= 4294967295, `seed ${seed}`);

  await drainComfyQueue();
  job = readComfyJob(queued.id)!;
  assert.equal(job.status, "running");
  assert.equal(job.promptId, "11111111-2222-3333-4444-555555555555");
  const submit = seen.find((item) => item.url === "/api/prompt")!;
  assert.equal(submit.key, "test-key");
  const sent = JSON.parse(submit.body!);
  assert.equal(sent.extra_data.api_key_comfy_org, "test-key");
  assert.equal(sent.prompt["5"].inputs.image, "abc123hash.png", "облачное имя картинки подставлено в LoadImage");

  await drainComfyQueue();
  assert.equal(readComfyJob(queued.id)!.status, "running", "облако ещё считает");

  jobStatus = "completed";
  // Опрос облака не чаще раза в 15 с: сдвигаем время.
  const realNow = Date.now;
  Date.now = () => realNow() + 60_000;
  try {
    await drainComfyQueue();
  } finally {
    Date.now = realNow;
  }
  job = readComfyJob(queued.id)!;
  assert.equal(job.status, "done", job.error);
  assert.deepEqual(job.files, ["s01_heygen_00001_.mp4"]);
  const saved = path.join(stageDir(EP, "s01", "final_render"), "output", "s01_heygen_00001_.mp4");
  assert.equal(fs.readFileSync(saved, "utf8"), "fake mp4 bytes");
  const signed = seen.find((item) => item.url === "/signed/file.mp4")!;
  assert.equal(signed.key, undefined, "ключ не уходит на подписанную ссылку");
  assert.equal(seen.filter((item) => item.url === "/api/prompt").length, 1);
});

test("прерванная отправка в облако не повторяется сама", async () => {
  fs.writeFileSync(path.join(stageDir(EP, "s01", "final_render"), "stage_state.json"), JSON.stringify({ phase: "idle" }));
  const queued = queueStageRun(EP, "s01", "final_render", { allowCloud: true });
  const file = path.join(tmp, "comfy_queue", `${queued.id}.json`);
  const job = JSON.parse(fs.readFileSync(file, "utf8"));
  // Будто доска упала посреди отправки: running без promptId.
  fs.writeFileSync(file, JSON.stringify({ ...job, status: "running" }));
  const before = seen.filter((item) => item.url === "/api/prompt").length;
  await drainComfyQueue();
  const after = readComfyJob(queued.id)!;
  assert.equal(after.status, "error");
  assert.match(after.error!, /прервалась/);
  assert.equal(seen.filter((item) => item.url === "/api/prompt").length, before);
});
