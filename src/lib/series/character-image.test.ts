// Выбранная картинка персонажа идёт в граф вместо базы по имени файла.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frameboard-character-image-"));
process.env.DATA_ROOT = tmp;
process.env.PLAYBOOKS_ROOT ||= path.resolve(__dirname, "../../../playbooks");
process.env.COMFY_URL = "http://127.0.0.1:9";
delete process.env.SERIES_ROOT;
process.env.FRAMEBOARD_LOOPS = "off";

import { buildPrompt, resolveImageInput } from "../comfy/binding";
import { queueStageRun } from "../comfy/stage-run";
import { requireStageBinding } from "../comfy/workflows";
import type { ImageInput } from "../contracts/graph-binding";
import { listLibraryCharacterNames } from "./character-base";
import { mediaUrlPath } from "./media";
import { createEpisode, ensureStageDirs, getCharactersRoot, shotDir, stageDir } from "./paths";
import { setCharacterImage } from "./run-settings";
import { stageInputs } from "./stage-inputs";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const baseInput: ImageInput = {
  kind: "image",
  from: ["refs", "library:character"],
  match: "{character}_base*",
  pick: "first",
  label: "база",
};
const clothesInput: ImageInput = {
  kind: "image",
  from: "refs",
  match: "{character}_clothes*",
  pick: "newest",
  min: 0,
  label: "одежда",
};

function writeShot(shotId: string, characters: string) {
  const file = path.join(shotDir("e01", shotId), "shot.md");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `# Кадр\n\n- characters: ${characters}\n- location: kitchen\n`);
  ensureStageDirs("e01", shotId);
}

test("выбранный референс, output и прошлый кадр становятся персонажем в графе", () => {
  createEpisode("e01");
  writeShot("s01", "lena");
  writeShot("s02", "lena");
  const library = path.join(getCharactersRoot(), "Lena");
  fs.mkdirSync(library, { recursive: true });
  fs.writeFileSync(path.join(library, "full_body.png"), PNG);

  const refs = path.join(stageDir("e01", "s02", "characters"), "refs");
  const coat = path.join(refs, "lena_coat.png");
  const clothes = path.join(refs, "lena_clothes.png");
  fs.writeFileSync(coat, PNG);
  fs.writeFileSync(clothes, PNG);
  const dressed = path.join(stageDir("e01", "s02", "characters"), "output", "lena_dressed.png");
  fs.writeFileSync(dressed, PNG);
  const earlier = path.join(stageDir("e01", "s01", "characters"), "output", "lena_s01.png");
  fs.writeFileSync(earlier, PNG);

  const ctx = { episodeId: "e01", shotId: "s02", stageId: "characters" as const, character: "lena" };
  assert.equal(path.basename(resolveImageInput(ctx, baseInput)[0]), "full_body.png");
  assert.deepEqual(
    resolveImageInput(ctx, clothesInput).map((file) => path.basename(file)),
    ["lena_clothes.png", "lena_coat.png"],
  );
  assert.deepEqual(listLibraryCharacterNames(), ["Lena"]);

  setCharacterImage("e01", "s02", "lena", mediaUrlPath(coat)!);
  assert.equal(path.basename(resolveImageInput(ctx, baseInput)[0]), "lena_coat.png");
  assert.deepEqual(resolveImageInput(ctx, clothesInput).map((file) => path.basename(file)), ["lena_clothes.png"]);
  fs.writeFileSync(
    path.join(stageDir("e01", "s02", "characters"), "prompt.md"),
    "## lena\nChange the jacket to a wool coat.\n",
  );
  const { binding, graph } = requireStageBinding("characters", "character_outfit");
  const built = buildPrompt(binding, graph, ctx);
  assert.ok(built.prompt["22"], "референс одежды включает второе изображение");
  assert.deepEqual(built.prompt["17"].inputs["images.image_2"], ["22", 0]);
  const row = stageInputs("e01", "s02", "characters").find((input) => input.label === "Персонаж lena");
  assert.equal(row?.files[0].name, "lena_coat.png");
  assert.match(row!.source, /выбран вручную/);

  setCharacterImage("e01", "s02", "lena", mediaUrlPath(dressed)!);
  assert.equal(path.basename(resolveImageInput(ctx, baseInput)[0]), "lena_dressed.png");

  setCharacterImage("e01", "s02", "lena", mediaUrlPath(earlier)!);
  assert.equal(path.basename(resolveImageInput(ctx, baseInput)[0]), "lena_s01.png");

  assert.throws(() => setCharacterImage("e01", "s02", "lena", mediaUrlPath(path.join(library, "full_body.png"))!), /output, refs или предыдущего/);

  fs.writeFileSync(path.join(refs, "lena_hat.png"), PNG);
  assert.throws(() => queueStageRun("e01", "s02", "characters"), /не больше одного референса/);
});
