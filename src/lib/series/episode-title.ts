import path from "path";
import { readTextIfExists, writeText } from "./media";
import { episodeRoot } from "./paths";

/** Название эпизода: первая строка «# …» в episode.md. Остальной текст файла и id папки не трогаются. */
export function setEpisodeTitle(episodeId: string, title: string): string {
  const next = title.trim().replace(/\s+/g, " ");
  if (!next) throw new Error("Название эпизода не может быть пустым");
  const file = path.join(episodeRoot(episodeId), "episode.md");
  const content = readTextIfExists(file);
  const updated = /^#\s+.+$/m.test(content)
    ? content.replace(/^#\s+.+$/m, `# ${next}`)
    : `# ${next}\n\n${content}`;
  writeText(file, updated.endsWith("\n") ? updated : `${updated}\n`);
  return next;
}
