import { notFound, redirect } from "next/navigation";
import { stagePagePath } from "@/components/stage/api";
import { readCurrentEpisodeId } from "@/lib/series/paths";

export const dynamic = "force-dynamic";

/** Старый адрес без эпизода: ведёт на этап в открытом эпизоде. */
export default async function LegacyStagePage(props: PageProps<"/shots/[shotId]/[stage]">) {
  const { shotId, stage } = await props.params;
  const episodeId = readCurrentEpisodeId();
  if (!episodeId) notFound();
  redirect(stagePagePath(episodeId, decodeURIComponent(shotId), decodeURIComponent(stage)));
}
