// Хранилище: явный эпизод, пути медиа, чтение без записей. Всё во временной DATA_ROOT.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-storage-"));
process.env.DATA_ROOT = tmp;
process.env.PLAYBOOKS_ROOT ||= path.resolve(__dirname, "../../../playbooks");
process.env.COMFY_URL = "http://127.0.0.1:9";
delete process.env.SERIES_ROOT;
(globalThis as { __frameboardComfyQueue?: boolean }).__frameboardComfyQueue = true;

import { submitAgentRequest } from "./agent-request";
import { reconcileAllStages } from "./agent-dispatch";
import { parseScenario } from "./bootstrap";
import { mediaUrlPath, resolveMediaPath, listMediaFiles } from "./media";
import { approveFiles } from "./mutations";
import {
  createEpisode,
  ensureStageDirs,
  getDataRoot,
  shotDir,
  stageDir,
  writeCurrentEpisodeId,
} from "./paths";
import { scanSeries } from "./scanner";
import { readStageStateFile, writeStageState } from "./stage-state";
import { deriveStageStatus } from "./status";

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
    "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
  "hex",
);

function makeShot(episodeId: string, shotId: string, shotMd: string) {
  fs.mkdirSync(shotDir(episodeId, shotId), { recursive: true });
  fs.writeFileSync(path.join(shotDir(episodeId, shotId), "shot.md"), shotMd);
  ensureStageDirs(episodeId, shotId);
}

function listAll(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listAll(full));
    else out.push(`${full}:${fs.statSync(full).mtimeMs}`);
  }
  return out.sort();
}

before(() => {
  createEpisode("e01");
  createEpisode("e010");
  createEpisode("e02");
  writeCurrentEpisodeId("e01");
  makeShot("e01", "s01", "# Кафе\n\n- characters: katya, mark\n- location: cafe\n");
  makeShot("e010", "s01", "# Другой эпизод\n\n- location: street\n");
  makeShot("e02", "s01", "# Улица\n\n- location: street\n");
  fs.writeFileSync(path.join(stageDir("e02", "s01", "location"), "refs", "view.png"), PNG);
  fs.mkdirSync(path.join(getDataRoot(), "characters", "katya"), { recursive: true });
  fs.writeFileSync(path.join(getDataRoot(), "characters", "katya", "portrait.png"), PNG);
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("parseScenario: кадры, персонажи, локация, текст", () => {
  const preview = parseScenario(
    "# Ночная смена\n\n## s1 — Кафе\n- characters: Katya, Old Mark\n- location: cafe\nКатя входит.\nСадится.\n\n## s02 Улица\n- локация: street\n",
  );
  assert.equal(preview.seriesTitle, "Ночная смена");
  assert.deepEqual(
    preview.shots.map((shot) => shot.id),
    ["s01", "s02"],
  );
  assert.equal(preview.shots[0].title, "Кафе");
  assert.deepEqual(preview.shots[0].characters, ["katya", "old_mark"]);
  assert.equal(preview.shots[0].location, "cafe");
  assert.equal(preview.shots[0].summary, "Катя входит.\nСадится.");
  assert.equal(preview.shots[1].location, "street");
});

test("approveFiles для персонажей: имя файла → слот персонажа, чужие файлы пропускаются", () => {
  const output = path.join(stageDir("e01", "s01", "characters"), "output");
  for (const name of ["katya_v1.png", "ComfyUI_mark_00001_.png", "other.png", "katya_v2.png"]) {
    fs.writeFileSync(path.join(output, name), PNG);
  }
  const saved = approveFiles({
    episodeId: "e01",
    shotId: "s01",
    stageId: "characters",
    filenames: ["katya_v1.png", "ComfyUI_mark_00001_.png", "other.png"],
  });
  assert.deepEqual(saved.sort(), ["katya_s01.png", "mark_s01.png"]);
  // Второй вариант Кати занимает тот же слот, а не добавляет файл.
  approveFiles({ episodeId: "e01", shotId: "s01", stageId: "characters", filenames: ["katya_v2.png"] });
  const approve = fs.readdirSync(path.join(stageDir("e01", "s01", "characters"), "approve")).sort();
  assert.deepEqual(approve, ["katya_s01.png", "mark_s01.png"]);
  assert.throws(
    () => approveFiles({ episodeId: "e01", shotId: "s01", stageId: "characters", filenames: ["other.png"] }),
    /не совпал с персонажем/,
  );
});

test("deriveStageStatus: активная фаза перекрывает папки", () => {
  const characters = ["katya", "mark"];
  assert.equal(deriveStageStatus("e01", "s01", "characters", characters), "approved");
  assert.equal(deriveStageStatus("e01", "s01", "characters", ["katya", "lena"]), "review");
  writeStageState("e01", "s01", "characters", { phase: "agent", requestId: "r1" });
  assert.equal(deriveStageStatus("e01", "s01", "characters", characters), "agent");
  writeStageState("e01", "s01", "characters", { phase: "error", error: "упало" });
  assert.equal(deriveStageStatus("e01", "s01", "characters", characters), "error");
  writeStageState("e01", "s01", "characters", { phase: "idle" });
  assert.equal(deriveStageStatus("e01", "s01", "location", []), "empty");
});

test("тот же кадр в разных эпизодах — разные папки", () => {
  assert.notEqual(stageDir("e01", "s01", "location"), stageDir("e02", "s01", "location"));
  assert.equal(scanSeries("e02").shots[0].title, "Улица");
  assert.equal(scanSeries().episodeId, "e01");
});

test("медиа: URL от data/, библиотеки читаются, выход за папку запрещён", () => {
  const portrait = path.join(getDataRoot(), "characters", "katya", "portrait.png");
  assert.equal(mediaUrlPath(portrait), "characters/katya/portrait.png");
  assert.equal(resolveMediaPath(["characters", "katya", "portrait.png"]), portrait);
  const [ref] = listMediaFiles(path.join(stageDir("e02", "s01", "location"), "refs"));
  assert.equal(ref.relativePath, "episodes/e02/shots/s01/location/refs/view.png");
  assert.match(ref.url, /^\/api\/media\/episodes\/e02\/shots\/s01\/location\/refs\/view\.png\?v=\d+$/);
  assert.equal(
    resolveMediaPath(["episodes", "e010", "shots", "s01", "shot.md"]),
    path.join(tmp, "episodes", "e010", "shots", "s01", "shot.md"),
  );
  assert.throws(() => resolveMediaPath(["episodes", "e01", "..", "e010", "x.png"]));
  assert.throws(() => resolveMediaPath(["comfy_queue", "job.json"]));
  assert.throws(() => resolveMediaPath(["current_episode.txt"]));
  assert.throws(() => resolveMediaPath(["episodes", "../x", "a.png"]));
  assert.equal(mediaUrlPath(path.join(tmp, "comfy_queue", "job.json")), null);
});

test("scanSeries ничего не пишет", () => {
  const before = listAll(tmp);
  scanSeries("e01");
  scanSeries("e02");
  scanSeries();
  assert.deepEqual(listAll(tmp), before);
});

test("фоновый цикл двигает запрос в неоткрытом эпизоде", () => {
  fs.writeFileSync(path.join(stageDir("e02", "s01", "location"), "prompt.md"), "Night street.");
  submitAgentRequest({
    episodeId: "e02",
    shotId: "s01",
    stageId: "location",
    message: "ночь",
    prompt: "Night street.",
    refsNote: "",
    workflowNote: "",
  });
  const requestFile = path.join(stageDir("e02", "s01", "location"), "agent_request.json");
  const request = JSON.parse(fs.readFileSync(requestFile, "utf8"));
  assert.equal(request.episodeId, "e02");
  fs.writeFileSync(requestFile, JSON.stringify({ ...request, status: "done" }));
  reconcileAllStages();
  const state = readStageStateFile("e02", "s01", "location");
  assert.equal(state?.phase, "comfy");
  const job = JSON.parse(fs.readFileSync(path.join(tmp, "comfy_queue", `${state!.jobId}.json`), "utf8"));
  assert.equal(job.episodeId, "e02");
  assert.equal(job.stageId, "location");
  // Открытый эпизод e01 не тронут.
  assert.equal(readStageStateFile("e01", "s01", "location"), null);
});
