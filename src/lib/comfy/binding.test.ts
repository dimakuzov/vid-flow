// Сборка prompt из манифеста и меню воркфлоу на своих графах во временной PLAYBOOKS_ROOT.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-binding-"));
process.env.DATA_ROOT = path.join(tmp, "data");
process.env.PLAYBOOKS_ROOT = path.join(tmp, "playbooks");
process.env.COMFY_URL = "http://127.0.0.1:9";
process.env.FRAMEBOARD_LOOPS = "off";
delete process.env.SERIES_ROOT;

import type { GraphBinding } from "../contracts/graph-binding";
import { createEpisode, ensureStageDirs, getLocationsRoot, shotDir, stageDir } from "../series/paths";
import type { StageId } from "../series/constants";
import { applySteps, buildPrompt, loadBindings, renderTemplate, validateBinding } from "./binding";
import { readComfyJob } from "./queue";
import { queueStageRun } from "./stage-run";
import { listWorkflowChoices, resolveWorkflowId } from "./workflows";

const EP = "e01";
const COMFY = path.join(process.env.PLAYBOOKS_ROOT, "workflows", "comfy");
const PNG = Buffer.from("89504e470d0a1a0a", "hex");

const GRAPH = {
  "1": { class_type: "LoadImage", inputs: { image: "x.png" } },
  "2": { class_type: "LoadImage", inputs: { image: "x.png" } },
  "3": { class_type: "LoadImage", inputs: { image: "x.png" } },
  "4": { class_type: "Text", inputs: { value: "graph text" } },
  "5": { class_type: "Sampler", inputs: { seed: 1, noise_seed: 1 } },
  "6": { class_type: "Number", inputs: { value: 5 } },
  "7": { class_type: "Save", inputs: { filename_prefix: "x" } },
  "8": { class_type: "Batch", inputs: { "images.image_1": ["1", 0], "images.image_2": ["2", 0], "images.image_3": ["3", 0] } },
};

function manifest(id: string, stage: StageId, order: number, extra: Partial<GraphBinding> = {}): GraphBinding {
  return {
    format: "frameboard.graph-binding/1",
    id,
    graph: "g.json",
    stage,
    label: `Вариант ${id}`,
    description: "",
    order,
    inputs: {},
    slots: [],
    ...extra,
  };
}

const FULL = manifest("full", "first_frame", 10, {
  playbook: "models/x.en.md",
  aliases: ["old"],
  inputs: {
    place: { kind: "image", from: ["refs", "library:location"], pick: "first", label: "Место" },
    people: { kind: "image", from: "approve:characters", pick: "all", min: 1, max: 2, uploadAs: "{episodeId}_{shotId}_p{index}{ext}", label: "Люди" },
    text: { kind: "text", from: "prompt", required: false, label: "prompt.md" },
    seconds: { kind: "number", from: "prompt:seconds", min: 2, max: 8, label: "Секунды" },
  },
  slots: [
    { targets: [{ node: "1", field: "image" }], value: { input: "place" } },
    { targets: [{ node: "2", field: "image" }], value: { input: "people", index: 0 } },
    {
      targets: [{ node: "3", field: "image" }],
      value: { input: "people", index: 1 },
      whenEmpty: { remove: [{ node: "3" }, { node: "8", field: "images.image_3" }] },
    },
    {
      targets: [{ node: "4", field: "value" }],
      value: {
        input: "text",
        steps: [{ namesTo: "the person" }, { ensure: "Static shot.", at: "start", unless: "\\b(camera|shot)\\b", separator: " " }],
        templates: [
          { when: { input: "people", countAtLeast: 2 }, text: "Two people.\n{text}\nShot {shotId}." },
          { text: "One person.\n{text}\nEnd." },
        ],
      },
    },
    { targets: [{ node: "5", field: "seed" }, { node: "5", field: "noise_seed" }], value: { seed: "random" } },
    { targets: [{ node: "6", field: "value" }], value: { input: "seconds" } },
    { targets: [{ node: "7", field: "filename_prefix" }], value: { template: "fb/{episodeId}/{stageId}/{shotId}_{workflow}" } },
  ],
});

function writeManifest(binding: GraphBinding, name = binding.id) {
  fs.writeFileSync(path.join(COMFY, `${name}.bind.json`), JSON.stringify(binding, null, 2));
}

function shot(shotId: string, characters: string[], location = "cafe") {
  const dir = shotDir(EP, shotId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "shot.md"), `# ${shotId}\n\n- characters: ${characters.join(", ")}\n- location: ${location}\n`);
  ensureStageDirs(EP, shotId);
}

function put(shotId: string, stage: StageId, sub: string, name: string, mtime?: number) {
  const file = path.join(stageDir(EP, shotId, stage), sub, name);
  fs.writeFileSync(file, PNG);
  if (mtime) fs.utimesSync(file, mtime, mtime);
}

function setPrompt(shotId: string, stage: StageId, text: string) {
  fs.writeFileSync(path.join(stageDir(EP, shotId, stage), "prompt.md"), text);
}

function build(shotId: string, binding = FULL) {
  let n = 0;
  return buildPrompt(binding, structuredClone(GRAPH), { episodeId: EP, shotId, stageId: binding.stage, random: () => ++n });
}

before(() => {
  fs.mkdirSync(COMFY, { recursive: true });
  fs.mkdirSync(path.join(process.env.PLAYBOOKS_ROOT!, "models"), { recursive: true });
  fs.writeFileSync(path.join(COMFY, "g.json"), JSON.stringify(GRAPH));
  writeManifest(FULL);
  writeManifest(
    manifest("second", "first_frame", 20, {
      inputs: { end: { kind: "image", from: "refs", pick: "newest", label: "Последний кадр" } },
      slots: [{ targets: [{ node: "1", field: "image" }], value: { input: "end" } }],
    }),
  );
  createEpisode(EP);
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("два персонажа: картинки, uploadAs, шаблон по числу, namesTo, seed на каждый target, template", () => {
  shot("s01", ["Катя", "Anna Lee"]);
  put("s01", "first_frame", "refs", "view10.png");
  put("s01", "first_frame", "refs", "view9.png");
  put("s01", "characters", "approve", "b.jpg");
  put("s01", "characters", "approve", "a.png");
  put("s01", "characters", "approve", "c.png");
  setPrompt("s01", "first_frame", "  Катя  hugs anna lee, 3 сек  ");
  const { prompt, uploads } = build("s01");
  assert.equal(prompt["1"].inputs.image, "view9.png", "first: числа по значению");
  assert.equal(prompt["2"].inputs.image, "e01_s01_p0.png");
  assert.equal(prompt["3"].inputs.image, "e01_s01_p1.jpg", "max 2, ext в нижнем регистре");
  assert.equal(prompt["4"].inputs.value, "Two people.\nStatic shot. the person hugs the person, 3 сек\nShot s01.");
  assert.equal(prompt["5"].inputs.seed, 1);
  assert.equal(prompt["5"].inputs.noise_seed, 2);
  assert.equal(prompt["6"].inputs.value, 3);
  assert.equal(prompt["7"].inputs.filename_prefix, "fb/e01/first_frame/s01_full");
  assert.deepEqual(
    uploads.map((u) => [path.basename(u.path), u.filename]),
    [["view9.png", "view9.png"], ["a.png", "e01_s01_p0.png"], ["b.jpg", "e01_s01_p1.jpg"]],
  );
});

test("один персонаж: whenEmpty удаляет ноду и ключ; пустой текст — строка шаблона удаляется; секунд нет — значение графа", () => {
  shot("s02", ["katya"], "Park");
  fs.mkdirSync(path.join(getLocationsRoot(), "park"), { recursive: true });
  fs.writeFileSync(path.join(getLocationsRoot(), "park", "a_copy.png"), PNG);
  fs.writeFileSync(path.join(getLocationsRoot(), "park", "b.png"), PNG);
  put("s02", "characters", "approve", "katya.png");
  setPrompt("s02", "first_frame", "");
  const binding = structuredClone(FULL);
  // Без ensure пустой текст остаётся пустым.
  (binding.slots[3].value as { steps: unknown[] }).steps = [{ namesTo: "the person" }];
  const { prompt } = build("s02", binding);
  assert.equal(prompt["1"].inputs.image, "b.png", "library:location без copy");
  assert.equal(prompt["3"], undefined);
  assert.ok(!("images.image_3" in prompt["8"].inputs));
  assert.ok("images.image_2" in prompt["8"].inputs);
  assert.equal(prompt["4"].inputs.value, "One person.\nEnd.");
  assert.equal(prompt["6"].inputs.value, 5);
});

test("библиотека: view.png важнее остальных; pick newest — по mtime", () => {
  shot("s03", ["katya"], "cafe");
  fs.mkdirSync(path.join(getLocationsRoot(), "cafe"), { recursive: true });
  fs.writeFileSync(path.join(getLocationsRoot(), "cafe", "a.png"), PNG);
  fs.writeFileSync(path.join(getLocationsRoot(), "cafe", "view.png"), PNG);
  put("s03", "characters", "approve", "katya.png");
  put("s03", "first_frame", "refs", "old.png", 1_000_000);
  put("s03", "first_frame", "refs", "new.png", 2_000_000);
  put("s03", "first_frame", "refs", "mid.png", 1_500_000);
  assert.equal(build("s03").prompt["1"].inputs.image, "mid.png", "refs есть — библиотека не нужна; first по имени");
  const second = JSON.parse(fs.readFileSync(path.join(COMFY, "second.bind.json"), "utf8"));
  assert.equal(build("s03", second).prompt["1"].inputs.image, "new.png");
  fs.rmSync(path.join(stageDir(EP, "s03", "first_frame"), "refs"), { recursive: true });
  fs.mkdirSync(path.join(stageDir(EP, "s03", "first_frame"), "refs"));
  assert.equal(build("s03").prompt["1"].inputs.image, "view.png");
});

test("ошибки запуска: нет обязательной картинки, пустой обязательный текст, инструкция доски", () => {
  shot("s04", ["katya"], "nowhere");
  put("s04", "characters", "approve", "katya.png");
  assert.throws(() => build("s04"), /is missing: Место/);
  put("s04", "first_frame", "refs", "v.png");
  const required = structuredClone(FULL);
  (required.inputs.text as { required: boolean }).required = true;
  setPrompt("s04", "first_frame", "   ");
  assert.throws(() => build("s04", required), /prompt\.md нет текста/);
  setPrompt("s04", "first_frame", "Собери shot-вариант s04\nПравила: playbooks/stages/first_frame.md\nShe smiles.");
  assert.throws(() => build("s04"), /prompt\.md содержит инструкцию для агента, а не текст для модели/);
  setPrompt("s04", "first_frame", "Персонажи: katya\nShe smiles.");
  assert.throws(() => build("s04"), /инструкцию для агента/);
});

test("steps и шаблоны: ensure в начало и конец, unless, пустой текст", () => {
  const steps = [
    { ensure: "Static shot, fixed camera.", at: "start" as const, unless: "\\b(camera|shot)\\b", separator: " " },
    { ensure: "Realistic.", at: "end" as const, unless: "realistic", separator: "\n" },
  ];
  assert.equal(applySteps("She walks.", steps, []), "Static shot, fixed camera. She walks.\nRealistic.");
  assert.equal(applySteps("Wide shot, she walks. Realistic.", steps, []), "Wide shot, she walks. Realistic.");
  assert.equal(applySteps("", steps, []), "Static shot, fixed camera.\nRealistic.");
  assert.equal(applySteps("Katya and Katyusha", [{ namesTo: "X" }], ["katya"]), "X and Katyusha");
  assert.equal(renderTemplate("A\n{text}\n  {text}{shotId}  \nB {text}", { text: "", shotId: "" }), "A\nB ");
});

test("проверка манифеста: пропавшая нода или поле — ошибка с именами манифеста, ноды и графа", () => {
  const broken = structuredClone(FULL);
  broken.slots[0].targets = [{ node: "99", field: "image" }];
  assert.throws(() => validateBinding(broken, structuredClone(GRAPH)), /манифест full: слот 1: ноды 99 нет в графе g\.json/);
  broken.slots[0].targets = [{ node: "1", field: "picture" }];
  assert.throws(() => validateBinding(broken, structuredClone(GRAPH)), /у ноды 1 \(LoadImage\) нет поля picture в графе g\.json/);
  const removal = structuredClone(FULL);
  removal.slots[2].whenEmpty = { remove: [{ node: "8", field: "images.image_9" }] };
  assert.throws(() => validateBinding(removal, structuredClone(GRAPH)), /whenEmpty: у ноды 8 \(Batch\) нет поля images\.image_9/);
  const backspace = structuredClone(FULL);
  (backspace.slots[3].value as { steps: { unless?: string }[] }).steps[1].unless = "\b(camera)\b";
  assert.throws(() => validateBinding(backspace, structuredClone(GRAPH)), /управляющий символ/);
});

test("меню: порядок, доступность по картинкам с min ≥ 1, по умолчанию — первый доступный, aliases", () => {
  shot("s05", ["katya"], "nowhere");
  setPrompt("s05", "first_frame", "");
  let choices = listWorkflowChoices(EP, "s05", "first_frame");
  assert.deepEqual(choices.map((c) => c.id), ["full", "second"]);
  assert.deepEqual(choices[0].missing, ["Место", "Люди"], "текст и число на доступность не влияют");
  assert.deepEqual(choices[1].missing, ["Последний кадр"]);
  assert.equal(choices[0].isDefault, true, "доступных нет — первый по order");
  assert.equal(choices[0].playbook, "models/x.en.md");
  put("s05", "first_frame", "refs", "end.png");
  choices = listWorkflowChoices(EP, "s05", "first_frame");
  assert.deepEqual(choices.map((c) => [c.id, c.available, c.isDefault]), [["full", false, false], ["second", true, true]]);
  assert.equal(resolveWorkflowId(EP, "s05", "first_frame", ""), "second");
  assert.equal(resolveWorkflowId(EP, "s05", "first_frame", "old"), "full");
  assert.throws(() => resolveWorkflowId(EP, "s05", "first_frame", "nope"), /Воркфлоу «nope» нет/);
});

test("этап без манифестов: пустое меню, запуск — понятная ошибка", () => {
  shot("s06", ["katya"]);
  assert.deepEqual(listWorkflowChoices(EP, "s06", "characters"), []);
  assert.throws(() => queueStageRun(EP, "s06", "characters"), /нет воркфлоу доски/);
});

test("сломанный манифест виден в меню недоступным, запуск — его ошибка; без кода: новый манифест сразу в меню", () => {
  shot("s07", ["katya"]);
  const bad = manifest("bad", "location", 10, {
    inputs: { text: { kind: "text", from: "prompt", required: true, label: "prompt.md" } },
    slots: [{ targets: [{ node: "404", field: "value" }], value: { input: "text" } }],
  });
  writeManifest(bad);
  const choices = listWorkflowChoices(EP, "s07", "location");
  assert.equal(choices[0].available, false);
  assert.match(choices[0].missing[0], /манифест bad: слот 1: ноды 404 нет в графе g\.json/);
  setPrompt("s07", "location", "Hello");
  assert.throws(() => queueStageRun(EP, "s07", "location"), /ноды 404 нет/);
  writeManifest(
    manifest("good", "location", 20, {
      inputs: { text: { kind: "text", from: "prompt", required: true, label: "prompt.md" } },
      slots: [{ targets: [{ node: "4", field: "value" }], value: { input: "text" } }],
    }),
  );
  assert.equal(resolveWorkflowId(EP, "s07", "location", ""), "good");
  const queued = queueStageRun(EP, "s07", "location");
  const job = readComfyJob(queued.id)!;
  assert.equal(job.workflow, "good");
  assert.equal(job.prompt["4"].inputs.value, "Hello");
  assert.ok(job.queuedAt);
  assert.ok(loadBindings().some((item) => item.id === "bad" && item.error));
});
