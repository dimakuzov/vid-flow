import { notFound } from "next/navigation";
import { StageWorkspace } from "@/components/stage/stage-workspace";
import { STAGES, type StageId } from "@/lib/series/constants";
import { listEpisodeIds, normalizeEpisodeId } from "@/lib/series/paths";
import { getStageDetail } from "@/lib/series/scanner";
import type { StageDetail } from "@/lib/series/types";

export const dynamic = "force-dynamic";

export default async function StagePage(props: PageProps<"/e/[episodeId]/shots/[shotId]/[stage]">) {
  const { episodeId: rawEpisode, shotId, stage } = await props.params;
  if (!STAGES.includes(stage as StageId)) notFound();
  let episodeId: string;
  try {
    episodeId = normalizeEpisodeId(decodeURIComponent(rawEpisode));
  } catch {
    notFound();
  }
  if (!listEpisodeIds().includes(episodeId)) notFound();
  let detail: StageDetail;
  try {
    detail = getStageDetail(episodeId, decodeURIComponent(shotId), stage as StageId);
  } catch {
    notFound();
  }
  return <StageWorkspace key={`${episodeId}/${detail.shotId}/${stage}`} initialDetail={detail} />;
}
