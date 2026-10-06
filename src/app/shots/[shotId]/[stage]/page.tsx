import { notFound } from "next/navigation";
import { StageWorkspace } from "@/components/stage/stage-workspace";
import { STAGES, type StageId } from "@/lib/series/constants";
import { readCurrentEpisodeId } from "@/lib/series/paths";
import { getStageDetail } from "@/lib/series/scanner";

export const dynamic = "force-dynamic";

export default async function StagePage({
  params,
}: {
  params: Promise<{ shotId: string; stage: string }>;
}) {
  const { shotId, stage } = await params;
  if (!STAGES.includes(stage as StageId)) notFound();
  // Эпизод пока берётся из открытого в шапке; перенос в URL — бриф 6.
  const episodeId = readCurrentEpisodeId();
  if (!episodeId) notFound();
  const detail = getStageDetail(episodeId, shotId, stage as StageId);
  return (
    <StageWorkspace
      shotId={shotId}
      stageId={stage as StageId}
      initialDetail={detail}
    />
  );
}
