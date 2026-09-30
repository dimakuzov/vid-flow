import { notFound } from "next/navigation";
import { StageWorkspace } from "@/components/stage/stage-workspace";
import { STAGES, type StageId } from "@/lib/series/constants";

export default async function StagePage({
  params,
}: {
  params: Promise<{ shotId: string; stage: string }>;
}) {
  const { shotId, stage } = await params;
  if (!STAGES.includes(stage as StageId)) notFound();
  return <StageWorkspace shotId={shotId} stageId={stage as StageId} />;
}
