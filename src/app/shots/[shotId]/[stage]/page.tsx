import { notFound } from "next/navigation";
import { StageWorkspace } from "@/components/stage/stage-workspace";
import { STAGES, type StageId } from "@/lib/series/constants";
import { getStageDetail } from "@/lib/series/scanner";

export const dynamic = "force-dynamic";

export default async function StagePage({
  params,
}: {
  params: Promise<{ shotId: string; stage: string }>;
}) {
  const { shotId, stage } = await params;
  if (!STAGES.includes(stage as StageId)) notFound();
  const detail = getStageDetail(shotId, stage as StageId);
  return (
    <StageWorkspace
      shotId={shotId}
      stageId={stage as StageId}
      initialDetail={detail}
    />
  );
}
