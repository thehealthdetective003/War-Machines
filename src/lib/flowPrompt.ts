import { PlannedScene, SceneDirection, T2VPromptProfile, TopicBrief } from '../types';
import { generatedClipDuration } from './sceneDuration';

const words = (value: string) => value.trim().split(/\s+/).filter(Boolean);
const truncateWords = (value: string, limit: number) => {
  const parts = words(value);
  return parts.length > limit ? `${parts.slice(0, limit).join(' ').replace(/[,:;|]+$/, '')}.` : value.trim();
};

export function normalizeConstraintList(value: unknown): string[] {
  const flattened: string[] = [];
  const visit = (item: unknown) => {
    if (Array.isArray(item)) return item.forEach(visit);
    if (typeof item === 'string') item.split(/\s*[,|]\s*/).map(part => part.trim()).filter(part => part && !/\[object Object\]/i.test(part)).forEach(part => flattened.push(part));
  };
  visit(value);
  const seen = new Set<string>();
  return flattened.filter(item => {
    const key = item.toLowerCase().replace(/^(no|avoid|without)\s+/, '').trim();
    if (key.length < 2 || seen.has(key)) return false;
    seen.add(key); return true;
  });
}

export function compactIdentity(topic: TopicBrief | null): string {
  if (!topic) return '';
  const lock = topic.product_identity_lock;
  const candidates = typeof topic.visual_lock === 'string' && topic.visual_lock.trim()
    ? [topic.visual_lock.split('|').slice(0, 6).join(', ')]
    : [lock?.core_geometry, lock?.surface_finish, lock?.markings, ...(Array.isArray(lock?.distinctive_features) ? lock!.distinctive_features.slice(0, 5) : [])];
  const normalized = normalizeConstraintList(candidates).join(', ');
  return truncateWords(normalized, 48);
}

export function relevantNegatives(direction: SceneDirection, topic: TopicBrief | null): string[] {
  const operational=['OPERATIONAL_CONTEXT','DYNAMIC_TESTING','DELIVERY_AND_ROLLOUT'].includes(direction.visual_family||'');
  const showdown=Boolean(direction.showdown_role);
  return normalizeConstraintList([
    direction.forbidden_elements,
    showdown?['morphing aircraft geometry','impossible camera paths including camera passing through the aircraft','unnatural sideways sliding','unverified flares or external stores']:[],
    operational?['weapon discharge','explosions or active combat','impossible aerobatics','changing product configuration','invented unit markings','exact event recreation','identifiable location claims']:[],
    direction.graphic_spec?['generated words or numbers','blank label cards or editor placeholders','fake HUD or telemetry','photorealistic or cinematic 3D materials','moving backgrounds','morphing or duplicated geometry']:[],
    topic?.visual_exclusions,
    topic?.negative_prompt_global,
    topic?.global_negative_prompts,
  ]).slice(0, 10);
}

export function profileInstruction(profile: T2VPromptProfile): string {
  const common = `Return one concise video_prompt per supplied scene, normally 55-85 words before application guards. The application adds the duration, canonical identity, audio rule, and compact exclusions, so do not repeat those blocks. Use exactly one primary action and one continuous camera movement. When showdown_role is present, obey its energy level and physically credible camera_platform, preserve forward momentum and stable geometry, and make the opening state, midpoint event, environmental response, and settled ending visible across the continuous clip. When graphic_spec is present, communicate only its visual_claim with the assigned text-free vector composition, motion pattern, annotations, and animation limit; require no editor work. Never include voiceover, labels, JSON, bullet lists, pipe-delimited data, headings, or abstract narration.`;
  return profile === 'omni-flash'
    ? `Write natural conversational directions optimized for Gemini Omni Flash. Emphasize believable physical motion, temporal progression, environmental response, and smooth cinematic camera behavior. ${common}`
    : `Write compact cinematography directions optimized for Veo in Google Flow. Emphasize subject composition, shot scale, lens, camera path, controlled action, lighting, material realism, and continuity. ${common}`;
}

type FocusedContextItem=Pick<SceneDirection,'stage_id'|'environment_ref'|'beat_id'|'reference_asset_ids'>|Pick<PlannedScene,'stage_id'|'environment_ref'|'beat_id'|'reference_asset_ids'>;
export function buildFocusedProductionContext(topic: TopicBrief | null, directions: FocusedContextItem[]) {
  const handoff=(topic as any)?._production_handoff;
  if(!handoff||typeof handoff!=='object') return null;
  const stageIds=new Set(directions.map(direction=>direction.stage_id).filter(Boolean));
  const environmentIds=new Set(directions.map(direction=>direction.environment_ref).filter(Boolean));
  const beatIds=new Set(directions.map(direction=>direction.beat_id).filter(Boolean));
  const stages=(Array.isArray(handoff.production_stages)?handoff.production_stages:[]).filter((stage:any)=>stageIds.has(stage.stage_id));
  stages.forEach((stage:any)=>{(stage.environment_ids||[]).forEach((id:string)=>environmentIds.add(id));if(stage.environment_id)environmentIds.add(stage.environment_id);});
  const moduleIds=new Set<string>();
  const referenceIds=new Set<string>();
  stages.forEach((stage:any)=>{
    if(stage.geometry_control?.primary_geometry_module_id)moduleIds.add(stage.geometry_control.primary_geometry_module_id);
    (stage.geometry_control?.secondary_geometry_module_ids||[]).forEach((id:string)=>moduleIds.add(id));
    (stage.visual_evidence?.reference_asset_ids||[]).forEach((id:string)=>referenceIds.add(id));
  });
  directions.forEach(direction=>(direction.reference_asset_ids||[]).forEach(id=>referenceIds.add(id)));
  const selectedBeats=(handoff.visual_story_plan?.chapters||[]).flatMap((chapter:any)=>chapter.visual_beats||[]).filter((beat:any)=>beatIds.has(beat.beat_id));
  selectedBeats.forEach((beat:any)=>(beat.reference_asset_ids||[]).forEach((id:string)=>referenceIds.add(id)));
  return {
    schema:handoff.schema,
    product:handoff.product,
    dimensions_and_proportions:handoff.dimensions_and_proportions,
    global_prompt_rules:handoff.global_prompt_rules,
    production_stages:stages,
    environments:(handoff.environments||[]).filter((environment:any)=>environmentIds.has(environment.environment_id)),
    geometry_modules:(handoff.geometry_modules||[]).filter((module:any)=>moduleIds.has(module.module_id)),
    reference_assets:(handoff.reference_assets||[]).filter((asset:any)=>referenceIds.has(asset.asset_id)),
    selected_beats:selectedBeats,
    stage_transitions:(handoff.stage_transitions||[]).filter((transition:any)=>stageIds.has(transition.from_stage_id)||stageIds.has(transition.to_stage_id)),
  };
}

export function focusedContextCharacterSavings(topic:TopicBrief|null,focused:unknown):number{
  const handoff=(topic as any)?._production_handoff;if(!handoff)return 0;
  return Math.max(0,JSON.stringify(handoff).length-JSON.stringify(focused).length);
}

function stripInjectedClauses(value: string): string {
  return value
    .replace(/(?:exact\s+)?\d+(?:\.\d+)?[-\s]second(?:\s+continuous)?\s+shot[.:]?/gi, ' ')
    .replace(/\b(?:global negatives?|forbidden elements?|required visible features?|visual lock verbatim)\s*:[^.!?]*(?:[.!?]|$)/gi, ' ')
    .replace(/\[object Object\]/gi, ' ')
    .replace(/\s+/g, ' ').trim();
}

const graphicComposition=(value:string):string=>({
  SINGLE_SUBJECT:'one dominant simplified subject with generous negative space',
  ORTHOGRAPHIC_CUTAWAY:'a clear orthographic cutaway with exposed layers kept visually separate',
  LEFT_TO_RIGHT_FLOW:'a clean left-to-right process composition',
  LAYERED_SEPARATION:'separated parallel layers aligned to one stable axis',
  TWO_PANEL_COMPARISON:'two balanced text-free panels on one shared visual baseline',
  CONCENTRIC_SIGNAL_FIELD:'a top-down concentric signal field with one clear source and response',
  SCHEMATIC_FACTORY:'a layered factory schematic with machinery foreground, process center, and simplified structure behind',
  SYMBOLIC_ROUTE:'a symbolic route through broad geometric terrain with no cartographic detail',
  MATCHED_SHAPE_TRANSITION:'one centered geometric form prepared as a stable transition anchor',
} as Record<string,string>)[value]||'one clear technical composition';
const graphicMotion=(value:string):string=>({
  MINIMAL_PARALLAX:'use only minimal parallax and a restrained light pass',
  HIGHLIGHT_PULSE:'pulse one clean highlight once around the relevant feature',
  FLOW_DRAW_ON:'draw one directional flow progressively through the composition',
  COMPONENT_TRANSLATION:'move one component along one mechanically credible path',
  LAYER_SEPARATION:'separate the layers gently while preserving their alignment and proportions',
  SIGNAL_SWEEP:'rotate one restrained signal sweep while the source and target remain fixed',
  HEAT_ZONE_PROGRESSION:'progress one clean cool-to-warm energy zone through the mechanism',
  CONTROLLED_ASSEMBLY:'move one tool or component through one controlled assembly interaction',
  MATCH_ANCHOR:'move gently toward the assigned centered transition shape without morphing it',
} as Record<string,string>)[value]||'keep all geometry stable';
const graphicAnnotations=(values:string[]):string=>values.map(value=>({
  DIRECTIONAL_ARROWS:'simple directional arrows',
  FLOW_LINES:'clean flow lines',
  HIGHLIGHT_RING:'one highlight ring',
  COLORED_ZONE:'one colored emphasis zone',
  SIGNAL_WAVES:'simple signal waves',
  MEASUREMENT_BASELINE:'an unlabeled measurement baseline',
} as Record<string,string>)[value]||'').filter(Boolean).join(' and ');

function compileGraphicFlowBody(direction:SceneDirection):string{
  const spec=direction.graphic_spec!;
  const annotations=graphicAnnotations(spec.annotation_devices);
  const motion=graphicMotion(spec.motion_pattern);
  const finalHold='Use the opening quarter to establish the complete composition, the middle half to explain the single relationship, and the final quarter as a steady comprehension hold';
  return `Create a premium 16:9 flat 2D vector technical explainer for one claim: ${spec.visual_claim}. Use ${graphicComposition(spec.composition)}${annotations?` with ${annotations}`:''}. ${motion}; animate no more than ${spec.maximum_animated_elements} elements while the background and all major geometry remain fixed. ${finalHold}. Use geometric silhouettes, minimal texture, restrained outlines, two-tone cel shading, pale cyan and blue, cool gray and charcoal, one red accent, and yellow-orange only for active heat or energy.`;
}

export function finalizeFlowPrompt(generated: string, direction: SceneDirection, topic: TopicBrief | null, profile: T2VPromptProfile): string {
  if (direction.graphic_spec) generated=compileGraphicFlowBody(direction);
  else if (direction.visual_treatment === 'STATIC_GRAPHIC_T2V') generated = `Create a stable unlabeled documentary technical composition with minimal parallax or a restrained light pass. ${direction.temporal_action?.opening_state || ''} ${direction.temporal_action?.mid_shot_progression || direction.primary_action} End with ${direction.temporal_action?.ending_state || 'a clean settled composition'}. Use a neutral technical space with no generated text or precise data.`;
  else if (direction.visual_treatment === 'MOTION_GRAPHIC_T2V') generated = `Create a controlled unlabeled documentary motion graphic showing components, material layers, paths, flows, or mechanical relationships. ${direction.temporal_action?.opening_state || ''} ${direction.temporal_action?.primary_motion || direction.primary_action} ${direction.temporal_action?.mid_shot_progression || ''} End with ${direction.temporal_action?.ending_state || 'the relationship clearly resolved'}. Use restrained abstract sound design with no generated text or precise data.`;
  const prefix = `${Number(generatedClipDuration(direction).toFixed(3))}-second continuous shot.`;
  const body = truncateWords(stripInjectedClauses(generated), direction.graphic_spec?125:65);
  const platform=direction.camera_platform?.toLowerCase().replaceAll('_',' ');
  const showdownClause=direction.showdown_role&&platform
    ? `Film from a physically credible ${platform}; sustain ${String(direction.energy_level||'MEDIUM').toLowerCase()} visual energy through one continuous, aerodynamically plausible action with stable geometry and a settled ending.`
    : '';
  const visibility=direction.product_visibility||(direction.state==='C'?'FULL':'PARTIAL');
  const identity = visibility==='NONE' ? '' : visibility==='DETAIL_ONLY' ? truncateWords(`Show only this component detail: ${direction.required_visible_features.slice(0,2).join(', ')}`,28) : direction.state === 'C'
    ? truncateWords(compactIdentity(topic), 38)
    : truncateWords(`Show only the incomplete State ${direction.state} condition: ${direction.product_visual_state}. Do not reveal finished or future-stage components`, 28);
  const identityClause = identity ? `${visibility==='DETAIL_ONLY'?'Component constraint':direction.state === 'C' ? 'Maintain this finished-product identity' : 'Assembly-state constraint'}: ${identity}` : '';
  const negatives = relevantNegatives(direction, topic);
  const cleanNegatives = negatives.map(value => value.replace(/^(?:no|avoid|without|do not include)\s+/i, '').trim()).filter(Boolean);
  const negativeTerms = truncateWords(cleanNegatives.join(', '), direction.showdown_role?36:24);
  const negativeClause = negativeTerms ? (profile === 'veo-flow' ? `Negative prompt: ${negativeTerms}` : `Exclude ${negativeTerms}`) : '';
  const operational=['OPERATIONAL_CONTEXT','DYNAMIC_TESTING','DELIVERY_AND_ROLLOUT'].includes(direction.visual_family||'');
  const productClass=`${(topic as any)?._production_handoff?.product?.product_class||''} ${topic?.topic?.product||''} ${direction.primary_action}`.toLowerCase();
  const operationalAudio=/helicopter|rotorcraft|rotor/.test(productClass)?'Generate synchronized rotor, engine, airflow, wind, and visible downwash sound.':/aircraft|airplane|fighter|jet|uas|uav|drone/.test(productClass)?'Generate synchronized propulsion, airflow, wind, and control-surface sound.':'Generate synchronized propulsion and environmental sound appropriate to the visible operation.';
  const audio = direction.visual_treatment&&direction.visual_treatment!=='LIVE_ACTION_T2V' ? 'Use restrained synchronized abstract documentary sound. Exclude dialogue, narration, music, and readable generated text.' : operational ? `${operationalAudio} Exclude dialogue, narration, and music.` : profile === 'omni-flash'
    ? 'Generate realistic synchronized ambient sound. Exclude dialogue, narration, music, and readable generated text.'
    : 'Audio: realistic ambient production sound synchronized to movement.';
  return [prefix, body, showdownClause, identityClause, audio, negativeClause].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

export function buildFlowContext(topic: TopicBrief | null, directions: SceneDirection[], profile: T2VPromptProfile) {
  return {
    target_profile: profile,
    canonical_finished_identity: compactIdentity(topic),
    cinematography_rules: topic?.cinematography_rules,
    continuity_rules: topic?.scene_continuity_rules,
    ...(profile === 'omni-flash' ? { authoritative_production_handoff: buildFocusedProductionContext(topic,directions) } : {}),
    scenes: directions.map(direction => ({ ...direction, relevant_forbidden_elements: relevantNegatives(direction, topic) })),
  };
}
