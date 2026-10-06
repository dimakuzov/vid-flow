// Проверка манифестов playbooks/workflows/comfy/*.bind.json против графов (docs/contracts/graph-binding.md).
// Пересохранил граф — запусти `npm test`: упадёт, если node id или поле больше не совпадают.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { STAGES } from "../series/constants";
import type { BindingInput, GraphBinding } from "./graph-binding";

const COMFY_DIR = path.resolve(__dirname, "../../../playbooks/workflows/comfy");
const PLAYBOOKS = path.resolve(__dirname, "../../../playbooks");

const manifests = fs
  .readdirSync(COMFY_DIR)
  .filter((name) => name.endsWith(".bind.json"))
  .sort();

function load(name: string): GraphBinding {
  return JSON.parse(fs.readFileSync(path.join(COMFY_DIR, name), "utf8")) as GraphBinding;
}

test("манифесты есть", () => {
  assert.ok(manifests.length > 0);
});

for (const name of manifests) {
  test(`манифест ${name}`, () => {
    const binding = load(name);
    assert.equal(binding.format, "frameboard.graph-binding/1");
    assert.equal(binding.id, name.slice(0, -".bind.json".length), "id = имя файла");
    assert.ok(STAGES.includes(binding.stage), `этап ${binding.stage}`);
    assert.ok(binding.label?.trim(), "label");
    assert.equal(typeof binding.order, "number");
    if (binding.playbook) {
      assert.ok(fs.existsSync(path.join(PLAYBOOKS, binding.playbook)), `нет плейбука ${binding.playbook}`);
    }

    const graphFile = path.join(COMFY_DIR, binding.graph);
    assert.ok(fs.existsSync(graphFile), `нет графа ${binding.graph}`);
    const graph = JSON.parse(fs.readFileSync(graphFile, "utf8")) as Record<
      string,
      { class_type?: string; inputs?: Record<string, unknown> }
    >;
    for (const [id, node] of Object.entries(graph)) {
      assert.ok(node.class_type && node.inputs, `${binding.graph}: нода ${id} не в формате API`);
    }

    const inputs: Record<string, BindingInput> = binding.inputs;
    for (const slot of binding.slots) {
      assert.ok(slot.targets.length > 0, "слот без targets");
      for (const target of slot.targets) {
        const node = graph[target.node];
        assert.ok(node, `${binding.id}: ноды ${target.node} нет в ${binding.graph}`);
        assert.ok(
          target.field in node.inputs!,
          `${binding.id}: у ноды ${target.node} (${node.class_type}) нет поля ${target.field}`,
        );
      }
      for (const removal of slot.whenEmpty?.remove ?? []) {
        const node = graph[removal.node];
        assert.ok(node, `${binding.id}: удаляемой ноды ${removal.node} нет`);
        if (removal.field) assert.ok(removal.field in node.inputs!, `${binding.id}: нет поля ${removal.node}.${removal.field}`);
      }
      const value = slot.value as Record<string, unknown>;
      if (typeof value.input === "string") {
        const input = inputs[value.input];
        assert.ok(input, `${binding.id}: слот ссылается на неизвестный вход ${value.input}`);
        for (const template of (value.templates as { when?: { input: string } }[] | undefined) ?? []) {
          if (template.when) assert.ok(inputs[template.when.input], `${binding.id}: when.input ${template.when.input}`);
        }
      } else {
        assert.ok(
          value.seed === "random" || typeof value.template === "string",
          `${binding.id}: значение слота должно быть input, seed или template`,
        );
      }
    }
  });
}

test("id манифестов уникальны, у каждого этапа порядок без повторов", () => {
  const all = manifests.map(load);
  assert.equal(new Set(all.map((b) => b.id)).size, all.length);
  for (const stage of STAGES) {
    const orders = all.filter((b) => b.stage === stage).map((b) => b.order);
    assert.equal(new Set(orders).size, orders.length, `повтор order у ${stage}`);
  }
});
