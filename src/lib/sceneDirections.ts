import { PlannedScene, SceneDirection, TimedScene } from '../types';
import { positiveSceneDuration } from './sceneDuration';

const requiredStrings: Array<keyof SceneDirection> = [
  'stage_id', 'subject', 'product_visual_state', 'primary_action', 'supporting_motion',
  'environment_ref', 'environment_description', 'lighting_and_material',
  'continuity_from_previous', 'transition_to_next',
];

const unique=(...lists:unknown[]):string[]=>{
  const seen=new Set<string>();
  return lists.flatMap(value=>Array.isArray(value)?value:[]).map(String).map(value=>value.trim()).filter(value=>{
    const key=value.toLowerCase();if(!value||seen.has(key))return false;seen.add(key);return true;
  });
};

export function ensureRequiredVisibleFeatures(item:any, plan?:PlannedScene):string[]{
  const supplied=Array.isArray(item?.required_visible_features)?item.required_visible_features.map(String).map((value:string)=>value.trim()).filter(Boolean):[];
  const authoritative=plan?.required_visible_features||[];
  if(supplied.length||authoritative.length)return unique(authoritative,supplied);
  if(plan?.visual_treatment==='STATIC_GRAPHIC_T2V'||plan?.visual_treatment==='MOTION_GRAPHIC_T2V')return ['unlabeled conceptual geometry and spatial relationships'];
  if(plan?.product_visibility==='NONE')return [String(item?.environment_description||item?.temporal_action?.opening_state||item?.subject||plan.visual_family.replaceAll('_',' ')).trim()].filter(Boolean);
  return [String(item?.subject||item?.product_visual_state||'assigned scene subject').trim()].filter(Boolean);
}

export function mergeDirectionMetadata(generated: any[], timedScenes: TimedScene[], plannedScenes: PlannedScene[] = [], generationDurationSeconds?: number): SceneDirection[] {
  const byNumber = new Map(generated.map(item => [Number(item?.number), item]));
  const planByNumber = new Map(plannedScenes.map(item => [item.number, item]));
  return timedScenes.map(timed => {
    const item = byNumber.get(timed.number) || {};
    const plan = planByNumber.get(timed.number)!;
    return {
      number: timed.number, start: timed.start, end: timed.end, duration: timed.duration,
      generation_duration_seconds: positiveSceneDuration(generationDurationSeconds) ?? timed.duration,
      voiceover: timed.text, silent: timed.silent,
      chapter_id: plan?.chapter_id || '', beat_id: plan?.beat_id || '', visual_family: plan?.visual_family,
      story_function: plan?.story_function, visual_treatment: plan?.visual_treatment,
      product_visibility: plan?.product_visibility, showdown_role:plan?.showdown_role ?? null,
      energy_level:plan?.energy_level, camera_platform:plan?.camera_platform ?? null,
      graphic_spec:plan?.graphic_spec ?? null,
      reference_asset_ids:plan?.reference_asset_ids||[],
      alignment_source:plan?.alignment_source,
      alignment_confidence:plan?.alignment_confidence,
      alignment_claim:plan?.alignment_claim,
      stage_id: plan?.stage_id || String(item.stage_id || ''), state: plan?.state || String(item.state||'').toUpperCase().replace(/^STATE[_\s-]*/,'') as 'A'|'B'|'C',
      subject: String(item.subject || ''), product_visual_state: String(item.product_visual_state || ''),
      primary_action: String(item.primary_action || ''), supporting_motion: String(item.supporting_motion || ''),
      environment_ref: plan?.environment_ref || String(item.environment_ref || ''), environment_description: String(item.environment_description || ''),
      camera: {
        shot_scale: String(item.camera?.shot_scale || ''), lens: String(item.camera?.lens || ''),
        angle: String(item.camera?.angle || ''), movement: String(item.camera?.movement || ''),
        movement_speed: String(item.camera?.movement_speed || ''),
      },
      lighting_and_material: String(item.lighting_and_material || ''),
      continuity_from_previous: unique([item.continuity_from_previous],plan?.continuity_requirements).join(' '), transition_to_next: String(item.transition_to_next || ''),
      required_visible_features: ensureRequiredVisibleFeatures(item,plan),
      forbidden_elements: unique(plan?.forbidden_elements,item.forbidden_elements),
      temporal_action: {
        opening_state: String(item.temporal_action?.opening_state || ''), primary_motion: String(item.temporal_action?.primary_motion || ''),
        physical_interaction: String(item.temporal_action?.physical_interaction || ''), mid_shot_progression: String(item.temporal_action?.mid_shot_progression || ''),
        ending_state: String(item.temporal_action?.ending_state || ''),
      },
    } as SceneDirection;
  });
}

export function validateSceneDirections(directions: unknown, timedScenes: TimedScene[], plannedScenes?: PlannedScene[], generationDurationSeconds?: number): string[] {
  if (!Array.isArray(directions)) return ['Directions must be a JSON array.'];
  const errors: string[] = [];
  if (directions.length !== timedScenes.length) errors.push(`Expected ${timedScenes.length} scenes; found ${directions.length}.`);
  const seen = new Set<number>();
  directions.forEach((direction: any, index) => {
    const label = `Scene ${index + 1}`;
    const number = Number(direction?.number);
    if (!Number.isInteger(number)) errors.push(`${label}: number must be an integer.`);
    if (seen.has(number)) errors.push(`${label}: duplicate scene number ${number}.`);
    seen.add(number);
    const timed = timedScenes[number - 1];
    if (!timed) { errors.push(`${label}: scene number ${number} is outside the transcript.`); return; }
    if (Math.abs(Number(direction.start) - timed.start) > 0.001 || Math.abs(Number(direction.end) - timed.end) > 0.001 || Math.abs(Number(direction.duration) - timed.duration) > 0.001) errors.push(`${label}: timing metadata was modified.`);
    const generationDuration = positiveSceneDuration(direction.generation_duration_seconds);
    if (generationDuration === null) errors.push(`${label}: generation_duration_seconds must be a positive number.`);
    const expectedGenerationDuration = positiveSceneDuration(generationDurationSeconds);
    if (expectedGenerationDuration !== null && generationDuration !== null && Math.abs(generationDuration - expectedGenerationDuration) > 0.001) errors.push(`${label}: generation_duration_seconds was modified.`);
    if (String(direction.voiceover ?? '') !== timed.text || Boolean(direction.silent) !== timed.silent) errors.push(`${label}: imported VO or silence metadata was modified.`);
    const plan = plannedScenes?.find(item => item.number === number);
    if (plan) (['chapter_id','beat_id','visual_family','story_function','visual_treatment','product_visibility','showdown_role','energy_level','camera_platform','stage_id','state'] as const).forEach(field => {
      const expected=(field==='showdown_role'||field==='camera_platform')?(plan[field]??null):plan[field];
      if (direction[field] !== expected) errors.push(`${label}: immutable plan field ${field} was modified.`);
    });
    if(plan&&JSON.stringify(direction.graphic_spec??null)!==JSON.stringify(plan.graphic_spec??null))errors.push(`${label}: immutable plan field graphic_spec was modified.`);
    if(plan&&JSON.stringify(direction.reference_asset_ids??[])!==JSON.stringify(plan.reference_asset_ids??[]))errors.push(`${label}: immutable reference evidence was modified.`);
    if(plan&&direction.alignment_source!==plan.alignment_source)errors.push(`${label}: immutable alignment source was modified.`);
    if(plan&&direction.alignment_claim!==plan.alignment_claim)errors.push(`${label}: immutable alignment claim was modified.`);
    if (!['A', 'B', 'C'].includes(direction.state)) errors.push(`${label}: state must be A, B, or C.`);
    requiredStrings.forEach(field => { if (!String(direction[field] || '').trim()) errors.push(`${label}: ${field} is required.`); });
    ['shot_scale', 'lens', 'angle', 'movement', 'movement_speed'].forEach(field => { if (!String(direction.camera?.[field] || '').trim()) errors.push(`${label}: camera.${field} is required.`); });
    if (!Array.isArray(direction.required_visible_features) || (direction.product_visibility!=='NONE'&&direction.required_visible_features.length===0)) errors.push(`${label}: required_visible_features must contain at least one item.`);
    if (!Array.isArray(direction.forbidden_elements) || direction.forbidden_elements.length === 0) errors.push(`${label}: forbidden_elements must contain at least one item.`);
    if(plan){
      const required=new Set((direction.required_visible_features||[]).map((value:string)=>value.toLowerCase()));
      (plan.required_visible_features||[]).forEach(value=>{if(!required.has(value.toLowerCase()))errors.push(`${label}: Engine must-show constraint was omitted: ${value}`);});
      const forbidden=new Set((direction.forbidden_elements||[]).map((value:string)=>value.toLowerCase()));
      (plan.forbidden_elements||[]).forEach(value=>{if(!forbidden.has(value.toLowerCase()))errors.push(`${label}: Engine negative constraint was omitted: ${value}`);});
    }
    if (plannedScenes) ['opening_state','primary_motion','physical_interaction','mid_shot_progression','ending_state'].forEach(field => { if (!String(direction.temporal_action?.[field] || '').trim()) errors.push(`${label}: temporal_action.${field} is required.`); });
  });
  timedScenes.forEach(scene => { if (!seen.has(scene.number)) errors.push(`Scene ${scene.number} is missing.`); });
  return [...new Set(errors)];
}

export interface StageSummaryItem {
  stage_id: string;
  scenes: number;
}

export function calculateStageSummary(directions: SceneDirection[]): StageSummaryItem[] {
  const counts = new Map<string, number>();
  directions.forEach(item => counts.set(item.stage_id, (counts.get(item.stage_id) || 0) + 1));
  return [...counts.entries()].map(([stage_id, scenes]) => ({ stage_id, scenes }));
}
