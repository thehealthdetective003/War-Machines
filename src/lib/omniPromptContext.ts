import type { PlannedScene, SceneDirection, TopicBrief } from '../types';

const words=(value:string)=>value.trim().split(/\s+/).filter(Boolean);
const truncateWords=(value:string,limit:number)=>{const parts=words(value);return parts.length>limit?`${parts.slice(0,limit).join(' ').replace(/[,:;|]+$/,'')}.`:value.trim();};

export function normalizeConstraintList(value:unknown):string[]{
  const flattened:string[]=[];
  const visit=(item:unknown)=>{if(Array.isArray(item))return item.forEach(visit);if(typeof item==='string')item.split(/\s*[,|]\s*/).map(part=>part.trim()).filter(part=>part&&!/\[object Object\]/i.test(part)).forEach(part=>flattened.push(part));};
  visit(value);const seen=new Set<string>();return flattened.filter(item=>{const key=item.toLowerCase().replace(/^(no|avoid|without)\s+/,'').trim();if(key.length<2||seen.has(key))return false;seen.add(key);return true;});
}

export function compactIdentity(topic:TopicBrief|null):string{
  if(!topic)return '';
  const lock=topic.product_identity_lock,candidates=typeof topic.visual_lock==='string'&&topic.visual_lock.trim()?[topic.visual_lock.split('|').slice(0,6).join(', ')]:[lock?.core_geometry,lock?.surface_finish,lock?.markings,...(Array.isArray(lock?.distinctive_features)?lock!.distinctive_features.slice(0,5):[])];
  return truncateWords(normalizeConstraintList(candidates).join(', '),48);
}

export function relevantNegatives(direction:SceneDirection,topic:TopicBrief|null):string[]{
  const operational=['OPERATIONAL_CONTEXT','DYNAMIC_TESTING','DELIVERY_AND_ROLLOUT'].includes(direction.visual_family||''),showdown=Boolean(direction.showdown_role);
  return normalizeConstraintList([direction.forbidden_elements,showdown?['morphing aircraft geometry','impossible camera paths including camera passing through the aircraft','unnatural sideways sliding','unverified flares or external stores']:[],operational?['weapon discharge','explosions or active combat','impossible aerobatics','changing product configuration','invented unit markings','exact event recreation','identifiable location claims']:[],direction.graphic_spec?['generated words or numbers','blank label cards or editor placeholders','fake HUD or telemetry','photorealistic or cinematic 3D materials','moving backgrounds','morphing or duplicated geometry']:[],topic?.visual_exclusions,topic?.negative_prompt_global,topic?.global_negative_prompts]).slice(0,10);
}

type FocusedContextItem=Pick<SceneDirection,'stage_id'|'environment_ref'|'beat_id'|'reference_asset_ids'>|Pick<PlannedScene,'stage_id'|'environment_ref'|'beat_id'|'reference_asset_ids'>;
export function buildFocusedProductionContext(topic:TopicBrief|null,directions:FocusedContextItem[]){
  const handoff=(topic as any)?._production_handoff;if(!handoff||typeof handoff!=='object')return null;
  const stageIds=new Set(directions.map(direction=>direction.stage_id).filter(Boolean)),environmentIds=new Set(directions.map(direction=>direction.environment_ref).filter(Boolean)),beatIds=new Set(directions.map(direction=>direction.beat_id).filter(Boolean));
  const stages=(Array.isArray(handoff.production_stages)?handoff.production_stages:[]).filter((stage:any)=>stageIds.has(stage.stage_id));
  stages.forEach((stage:any)=>{(stage.environment_ids||[]).forEach((id:string)=>environmentIds.add(id));if(stage.environment_id)environmentIds.add(stage.environment_id);});
  const moduleIds=new Set<string>(),referenceIds=new Set<string>();
  stages.forEach((stage:any)=>{if(stage.geometry_control?.primary_geometry_module_id)moduleIds.add(stage.geometry_control.primary_geometry_module_id);(stage.geometry_control?.secondary_geometry_module_ids||[]).forEach((id:string)=>moduleIds.add(id));(stage.visual_evidence?.reference_asset_ids||[]).forEach((id:string)=>referenceIds.add(id));});
  directions.forEach(direction=>(direction.reference_asset_ids||[]).forEach(id=>referenceIds.add(id)));
  const selectedBeats=(handoff.visual_story_plan?.chapters||[]).flatMap((chapter:any)=>chapter.visual_beats||[]).filter((beat:any)=>beatIds.has(beat.beat_id));selectedBeats.forEach((beat:any)=>(beat.reference_asset_ids||[]).forEach((id:string)=>referenceIds.add(id)));
  return {schema:handoff.schema,product:handoff.product,dimensions_and_proportions:handoff.dimensions_and_proportions,global_prompt_rules:handoff.global_prompt_rules,production_stages:stages,environments:(handoff.environments||[]).filter((environment:any)=>environmentIds.has(environment.environment_id)),geometry_modules:(handoff.geometry_modules||[]).filter((module:any)=>moduleIds.has(module.module_id)),reference_assets:(handoff.reference_assets||[]).filter((asset:any)=>referenceIds.has(asset.asset_id)),selected_beats:selectedBeats,stage_transitions:(handoff.stage_transitions||[]).filter((transition:any)=>stageIds.has(transition.from_stage_id)||stageIds.has(transition.to_stage_id))};
}

export function focusedContextCharacterSavings(topic:TopicBrief|null,focused:unknown):number{const handoff=(topic as any)?._production_handoff;if(!handoff)return 0;return Math.max(0,JSON.stringify(handoff).length-JSON.stringify(focused).length);}

export function buildOmniPromptContext(topic:TopicBrief|null,directions:SceneDirection[]){
  return {target_profile:'omni-flash',canonical_finished_identity:compactIdentity(topic),cinematography_rules:topic?.cinematography_rules,continuity_rules:topic?.scene_continuity_rules,authoritative_production_handoff:buildFocusedProductionContext(topic,directions),scenes:directions.map(direction=>({...direction,relevant_forbidden_elements:relevantNegatives(direction,topic)}))};
}
