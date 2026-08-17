export const DEFAULT_SCENE_DURATION_SECONDS = 6;

export function positiveSceneDuration(value: unknown): number | null {
  const duration = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

function productionHandoff(value: any): any {
  const candidates = [
    value?._production_handoff,
    value?.topic?._production_handoff,
    value,
  ];
  return candidates.find(candidate => candidate?.schema?.version === '2.0.0') || null;
}

export function v2HandoffSceneDuration(value: unknown): number | null {
  const handoff = productionHandoff(value);
  return positiveSceneDuration(
    handoff?.visual_story_plan?.rhythm_policy?.preferred_usable_scene_duration_seconds?.preferred,
  );
}

export function projectOrTranscriptSceneDuration(value: any, fallback: unknown = DEFAULT_SCENE_DURATION_SECONDS): number {
  return v2HandoffSceneDuration(value)
    ?? positiveSceneDuration(value?.voiceoverTranscription?.sceneDurationSeconds)
    ?? positiveSceneDuration(fallback)
    ?? DEFAULT_SCENE_DURATION_SECONDS;
}

export function generatedClipDuration(direction: { duration: number; generation_duration_seconds?: number }): number {
  return positiveSceneDuration(direction.generation_duration_seconds)
    ?? positiveSceneDuration(direction.duration)
    ?? DEFAULT_SCENE_DURATION_SECONDS;
}
