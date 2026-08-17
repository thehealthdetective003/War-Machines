import { TopicBrief } from '../types';

function parseAnchorComponents(anchor: string): { positive: string; negatives: string } {
  if (!anchor) return { positive: '', negatives: '' };
  const positive: string[] = [];
  const negatives: string[] = [];
  for (const clause of anchor.split(/\s+[—–-]\s+|,\s+/)) {
    const value = clause.trim();
    if (/^(NOT|NO)\s+/i.test(value)) negatives.push(value.replace(/^(NOT|NO)\s+/i, '').trim());
    else if (value) positive.push(value);
  }
  return { positive: positive.join(' — '), negatives: negatives.join(', ') };
}

export type LifecycleStage = NonNullable<TopicBrief['lifecycle_stages']>[number];
export type Environment = TopicBrief['environments'][number];

const isV2 = (data: any) =>
  String(data?.schema_version || '').includes('2') ||
  !!data?.product_identity_lock ||
  Array.isArray(data?.negative_prompt_global) ||
  !!data?.cinematography_rules ||
  !!data?.scene_continuity_rules ||
  Array.isArray(data?.shot_plan);

const asArray = (value: any): string[] => {
  if (Array.isArray(value)) return value.map(String).map(x => x.trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map(x => x.trim()).filter(Boolean);
  return [];
};

const resolveVisualLock = (input: any) => {
  if (typeof input?.visual_lock === 'string' && input.visual_lock.trim()) return input.visual_lock.trim();
  return parseAnchorComponents(input?.anti_hallucination_anchor || '').positive;
};

const resolveVisualExclusions = (input: any) => {
  if (typeof input?.visual_exclusions === 'string' && input.visual_exclusions.trim()) return input.visual_exclusions.trim();
  return parseAnchorComponents(input?.anti_hallucination_anchor || '').negatives;
};

export function getNegativePromptGlobal(topic?: TopicBrief | null): string[] {
  if (!topic) return [];
  if (Array.isArray(topic.negative_prompt_global)) return topic.negative_prompt_global.map(String).filter(Boolean);
  return asArray(topic.global_negative_prompts);
}

export function normalizeTopicBrief(input: any): TopicBrief {
  const visualLock = resolveVisualLock(input);
  const visualExclusions = resolveVisualExclusions(input);
  const negativePromptGlobal = Array.isArray(input?.negative_prompt_global)
    ? input.negative_prompt_global
    : asArray(input?.global_negative_prompts);

  return {
    ...input,
    topic: input?.topic || { title: '', category: '' },
    global_visual_constants: input?.global_visual_constants || '',
    visual_lock: visualLock || input?.visual_lock,
    visual_exclusions: visualExclusions || input?.visual_exclusions,
    negative_prompt_global: negativePromptGlobal,
    environments: Array.isArray(input?.environments) ? input.environments : [],
    lifecycle_stages: Array.isArray(input?.lifecycle_stages)
      ? input.lifecycle_stages.map((stage: any, index: number) => ({
          ...stage,
          stage_id: stage.stage_id || `S${String(index + 1).padStart(2, '0')}`,
        }))
      : input?.lifecycle_stages,
    lifecycle_stage_count: input?.lifecycle_stage_count ?? input?.lifecycle_stages?.length,
  } as TopicBrief;
}

export function getLifecycleStages(topic?: TopicBrief | null): LifecycleStage[] {
  return Array.isArray(topic?.lifecycle_stages) ? topic!.lifecycle_stages! : [];
}

export function getLifecycleStageCount(topic?: TopicBrief | null): number {
  const raw = topic?.lifecycle_stage_count;
  const parsed = typeof raw === 'number' ? raw : parseInt(String(raw || ''), 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return getLifecycleStages(topic).length;
}

export function getEnvironmentForStage(topic: TopicBrief, stage: LifecycleStage): Environment | undefined {
  return topic.environments?.find(env =>
    env.name === stage.environment_ref ||
    env.environment_id === stage.environment_ref ||
    env.stage_ref === stage.stage_id
  );
}

export function buildProductIdentitySummary(topic?: TopicBrief | null): string {
  const lock = topic?.product_identity_lock;
  if (!lock) return '';
  return [
    lock.core_geometry,
    lock.surface_finish,
    lock.markings,
    lock.scale_reference,
    ...(lock.distinctive_features || []),
  ].filter(Boolean).join(' | ');
}

export function validateAdaptiveBrief(data: any): string[] {
  const normalized = normalizeTopicBrief(data || {});
  const missing: string[] = [];
  if (!normalized.topic?.title) missing.push('topic.title');
  if (!normalized.topic?.product) missing.push('topic.product');
  if (!normalized.topic?.category) missing.push('topic.category');
  if (!normalized.global_visual_constants) missing.push('global_visual_constants');
  if (!normalized.visual_lock && !normalized.anti_hallucination_anchor) missing.push('visual_lock');
  if (!normalized.visual_exclusions) missing.push('visual_exclusions');
  if (!normalized.environments?.length) missing.push('environments');
  if (!normalized.lifecycle_stages?.length) missing.push('lifecycle_stages');
  if (isV2(data) && getNegativePromptGlobal(normalized).length === 0) missing.push('negative_prompt_global');
  return missing;
}

export function validateAdaptiveWarnings(data: any): string[] {
  const topic = normalizeTopicBrief(data || {});
  const warnings: string[] = [];
  const v2 = isV2(data);
  const count = getLifecycleStageCount(topic);
  const exclusions = topic.visual_exclusions || '';
  const notClauses = (exclusions.match(/\b(?:NOT|NO)\b/gi) || []).length;

  if (v2 && (count < 5 || count > 8)) warnings.push(`lifecycle_stage_count should resolve to 5-8; currently ${count || 0}`);
  if (!topic.product_identity_lock) warnings.push('product_identity_lock missing');
  if (!topic.visual_lock) warnings.push('visual_lock missing; legacy anchor fallback may be used');
  if (notClauses < 2) warnings.push('visual_exclusions should include at least two NOT/NO clauses');
  if (getNegativePromptGlobal(topic).length === 0) warnings.push('global negative prompts missing');

  getLifecycleStages(topic).forEach((stage, index) => {
    const label = stage.stage_id || `stage ${index + 1}`;
    if (!['A', 'B', 'C'].includes(stage.state || '')) warnings.push(`${label} missing state A/B/C`);
    if (!getEnvironmentForStage(topic, stage)) warnings.push(`${label} environment_ref has no matching environment`);
    if (v2 && (!stage.primary_camera_shot || !stage.motion_direction || !stage.quality_control_focus || !stage.visual_risk_notes)) {
      warnings.push(`${label} missing camera, motion, QC, or visual risk guidance`);
    }
  });

  const qcText = JSON.stringify(topic.quality_control || {});
  if (/\bFAIL\b/i.test(qcText)) warnings.push('quality_control contains FAIL');
  if (/\bFLAGGED\b/i.test(qcText)) warnings.push('quality_control contains FLAGGED items');
  const truthText = JSON.stringify({
    topic: topic.topic,
    product_identity_lock: topic.product_identity_lock,
    visual_lock: topic.visual_lock,
    lifecycle_stages: topic.lifecycle_stages,
  });
  if (/\bUNVERIFIED\b/i.test(truthText)) warnings.push('UNVERIFIED appears in final truth fields');
  return warnings;
}
