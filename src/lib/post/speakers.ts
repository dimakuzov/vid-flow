import fs from "fs";
import path from "path";
import { getCharactersRoot } from "../series/paths";
import { canonicalCharacter, libraryCharacterDir, postDir, readJson, writeJson } from "./paths";

/*
 * Кто говорит за имя из сценария. Имена в speech.md — как их разобрал сценарий (BABUSHKA, MALE VOICE);
 * голос, файл озвучки и дорожка — у персонажа библиотеки (ba, militsiya_officer_young).
 *   1. Назначение эпизода: `post/speakers.json` → `{ "map": { "BABUSHKA": "ba" } }`.
 *   2. Запомненное для всех эпизодов: `data/characters/{Name}/voice.json` → `"aliases": ["BABUSHKA"]`.
 *   3. Иначе — папка библиотеки с тем же именем без учёта регистра, иначе имя как есть.
 * Два имени на одного персонажа — одна озвучка и одна дорожка. speech.md не меняется: текст и субтитры те же.
 */

export type SpeakerSource = "episode" | "alias" | "library" | "none";

interface SpeakersFile {
  map: Record<string, string>;
  updatedAt?: string;
}

const key = (name: string) => name.trim().toLowerCase();

function speakersFile(episodeId: string): string {
  return path.join(postDir(episodeId), "speakers.json");
}

export function readSpeakerMap(episodeId: string): Record<string, string> {
  const data = readJson<SpeakersFile>(speakersFile(episodeId));
  const map: Record<string, string> = {};
  for (const [name, character] of Object.entries(data?.map ?? {})) {
    if (typeof character === "string" && character.trim()) map[key(name)] = character.trim();
  }
  return map;
}

/** Псевдонимы из библиотеки: имя из сценария → папка персонажа. */
export function readLibraryAliases(): Record<string, string> {
  const aliases: Record<string, string> = {};
  let folders: string[] = [];
  try {
    folders = fs.readdirSync(getCharactersRoot(), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return aliases;
  }
  for (const folder of folders) {
    const voice = readJson<{ aliases?: unknown }>(path.join(getCharactersRoot(), folder, "voice.json"));
    if (!Array.isArray(voice?.aliases)) continue;
    for (const alias of voice.aliases) if (typeof alias === "string" && alias.trim()) aliases[key(alias)] = folder;
  }
  return aliases;
}

/** Персонажи библиотеки (папки `data/characters/`) — варианты для назначения. */
export function listLibraryCharacters(): string[] {
  try {
    return fs
      .readdirSync(getCharactersRoot(), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  } catch {
    return [];
  }
}

/** Резолвер имён эпизода: читает назначения один раз. */
export function speakerResolver(episodeId: string): (speaker: string) => { character: string; source: SpeakerSource } {
  const map = readSpeakerMap(episodeId);
  const aliases = readLibraryAliases();
  return (speaker) => {
    const name = speaker.trim();
    if (!name) return { character: "", source: "none" };
    const assigned = map[key(name)];
    if (assigned) return { character: canonicalCharacter(assigned), source: "episode" };
    const alias = aliases[key(name)];
    if (alias) return { character: alias, source: "alias" };
    const library = libraryCharacterDir(name);
    return library ? { character: path.basename(library), source: "library" } : { character: name, source: "none" };
  };
}

/**
 * Назначить имени из сценария персонажа библиотеки (null — снять назначение эпизода).
 * `remember` — ещё и псевдоним в voice.json персонажа: в следующих эпизодах имя найдётся само.
 */
export function assignSpeaker(episodeId: string, speaker: string, character: string | null, remember = false): void {
  const name = speaker.trim();
  if (!name) throw new Error("Нет имени из сценария");
  const data = readJson<SpeakersFile>(speakersFile(episodeId)) ?? { map: {} };
  const map: Record<string, string> = {};
  for (const [existing, value] of Object.entries(data.map ?? {})) if (key(existing) !== key(name)) map[existing] = value;
  if (character) {
    const dir = libraryCharacterDir(character);
    if (!dir) throw new Error(`Нет персонажа «${character}» в data/characters`);
    map[name] = path.basename(dir);
    if (remember) addLibraryAlias(path.basename(dir), name);
  }
  writeJson(speakersFile(episodeId), { map, updatedAt: new Date().toISOString() });
}

/** Псевдоним в voice.json персонажа (остальные поля не трогаются; у других персонажей этот псевдоним снимается). */
export function addLibraryAlias(character: string, alias: string): void {
  for (const folder of listLibraryCharacters()) {
    const file = path.join(getCharactersRoot(), folder, "voice.json");
    const voice = readJson<Record<string, unknown>>(file);
    const own = folder.toLowerCase() === character.toLowerCase();
    if (!voice && !own) continue;
    const current = Array.isArray(voice?.aliases) ? (voice!.aliases as unknown[]).filter((item): item is string => typeof item === "string") : [];
    const without = current.filter((item) => key(item) !== key(alias));
    const next = own ? [...without, alias.trim()] : without;
    if (next.length === current.length && next.every((item, index) => item === current[index])) continue;
    writeJson(file, { ...(voice ?? {}), aliases: next });
  }
}
