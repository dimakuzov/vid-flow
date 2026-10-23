import fs from "fs";
import os from "os";
import path from "path";
import { postDir } from "./paths";

/*
 * Настройки рендера доски — и в Kdenlive: свой пресет «Frameboard» в его пользовательских пресетах
 * (`%LOCALAPPDATA%/kdenlive/export/customprofiles.xml`, так их читает RenderPresetRepository Kdenlive)
 * и выбор этого пресета с путём вывода в самом проекте (`kdenlive:docproperties.render*`).
 * Тогда Render (Ctrl+Enter) в Kdenlive сразу даёт то же, что «Добавить субтитры»: H.264 1.6 Мбит/с, AAC 192 кбит/с.
 */

export const RENDER_PRESET_NAME = "Frameboard MP4 H264 1600k";
export const RENDER_VIDEO_KBPS = 1600;
export const RENDER_AUDIO_KBPS = 192;

/** Как пресеты Kdenlive с битрейтом (NVENC H264 ABR): `%bitrate`, `%audiobitrate` подставляет окно рендера. */
const PRESET = `<profile name="${RENDER_PRESET_NAME}" category="custom" extension="mp4"
  bitrates="8000,500" defaultbitrate="${RENDER_VIDEO_KBPS}"
  audiobitrates="128,160,192,256,320" defaultaudiobitrate="${RENDER_AUDIO_KBPS}"
  speeds="preset=veryslow;preset=slower;preset=slow;preset=medium;preset=fast;preset=faster;preset=veryfast" defaultspeedindex="3"
  args="f=mp4 movflags=+faststart vcodec=libx264 vb=%bitrate+'k' pix_fmt=yuv420p g=48 acodec=aac ab=%audiobitrate+'k' ar=48000 ac=2"/>`;

export function kdenlivePresetFile(): string {
  const base = process.env.KDENLIVE_DATA?.trim() || process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return path.join(base, "kdenlive", "export", "customprofiles.xml");
}

/** Пишет пресет «Frameboard» в пользовательские пресеты Kdenlive; чужие пресеты в файле остаются. */
export function ensureKdenliveRenderPreset(file = kdenlivePresetFile()): void {
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    text = "";
  }
  const own = new RegExp(`\\s*<profile name="${RENDER_PRESET_NAME}"[\\s\\S]*?/>`, "g");
  if (!/<profiles[\s>]/.test(text)) {
    text = `<?xml version="1.0"?>\n<profiles version="1">\n</profiles>\n`;
  }
  const without = text.replace(own, "");
  const next = without.replace(/<\/profiles>/, ` ${PRESET}\n</profiles>`);
  if (next === text) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, next, "utf8");
}

function xml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Выбор пресета и путь вывода в проекте: свойства корзины `kdenlive:docproperties.render*`
 * (как их пишет сам Kdenlive). Пустой проект (без корзины) не меняется.
 */
export function setProjectRenderSettings(project: string, outputFile: string): string {
  const binStart = project.indexOf('<playlist id="main_bin"');
  if (binStart < 0) return project;
  const binEnd = project.indexOf("</playlist>", binStart);
  let bin = project.slice(binStart, binEnd);
  const values: Record<string, string | number> = {
    rendercategory: "custom",
    renderprofile: RENDER_PRESET_NAME,
    renderurl: outputFile.split(path.sep).join("/"),
    renderrescale: 0,
    rendermode: 0,
    rendertwopass: 0,
    renderexportaudio: 0,
    renderspeed: 3,
  };
  for (const [name, value] of Object.entries(values)) {
    const property = `<property name="kdenlive:docproperties.${name}">${xml(String(value))}</property>`;
    const pattern = new RegExp(`<property name="kdenlive:docproperties\\.${name}">[^<]*</property>`);
    bin = pattern.test(bin) ? bin.replace(pattern, property) : bin.replace(/(<playlist id="main_bin"[^>]*>)/, `$1\n  ${property}`);
  }
  return project.slice(0, binStart) + bin + project.slice(binEnd);
}

/** Куда Kdenlive по умолчанию рендерит проект: `post/render/{проект}_kdenlive.mp4`. */
export function kdenliveRenderFile(episodeId: string, project: string): string {
  return path.join(postDir(episodeId), "render", `${path.basename(project, ".kdenlive")}_kdenlive.mp4`);
}

/** Пресет — в Kdenlive, выбор пресета и путь вывода — в проект. Сбой записи пресета не мешает остальному. */
export function applyRenderSettings(episodeId: string, project: string): void {
  try {
    ensureKdenliveRenderPreset();
  } catch (error) {
    console.error("[frameboard] пресет рендера Kdenlive:", error);
  }
  const output = kdenliveRenderFile(episodeId, project);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const text = fs.readFileSync(project, "utf8");
  const next = setProjectRenderSettings(text, output);
  if (next === text) return;
  fs.writeFileSync(`${project}.tmp`, next, "utf8");
  fs.renameSync(`${project}.tmp`, project);
}
