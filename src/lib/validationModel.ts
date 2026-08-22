import type { PlannedScene, SceneDirection, TimedScene, TopicBrief, ValidationFinding, ValidationSeverity } from '../types';
import type { V2ProductionStage, V2VisualBeat, VisualProductionHandoffV2 } from '../types/visualProductionV2';
import { directionSemanticIssues } from './directionSemantics';
import { validateSceneDirections } from './sceneDirections';
import { resolveSceneContract, sceneEnvironmentAllowed, v2HandoffFor } from './sceneContract';

export const MAX_SEMANTIC_CORRECTION_ATTEMPTS=1;
export const MAX_TARGETED_BLOCKING_REPAIR_ATTEMPTS=1;
export const severityRank:Record<ValidationSeverity,number>={PASS:0,WARNING:1,REPAIRABLE_ERROR:2,BLOCKING_ERROR:3};
export const highestSeverity=(findings:ValidationFinding[]):ValidationSeverity=>findings.reduce<ValidationSeverity>((highest,item)=>severityRank[item.severity]>severityRank[highest]?item.severity:highest,'PASS');
export const blockingFindings=(findings:ValidationFinding[])=>findings.filter(item=>item.severity==='BLOCKING_ERROR');
export const repairableFindings=(findings:ValidationFinding[])=>findings.filter(item=>item.severity==='REPAIRABLE_ERROR');
export const warningFindings=(findings:ValidationFinding[])=>findings.filter(item=>item.severity==='WARNING');

const handoffFor=(topic:TopicBrief|null):VisualProductionHandoffV2|null=>v2HandoffFor(topic);
const beats=(handoff:VisualProductionHandoffV2)=>handoff.visual_story_plan.chapters.flatMap(chapter=>chapter.visual_beats);
const finding=(sceneNumber:number,code:string,severity:ValidationSeverity,message:string,details:Partial<ValidationFinding>={}):ValidationFinding=>({sceneNumber,code,severity,message,...details});
const normalized=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const creativeText=(direction:SceneDirection)=>normalized([direction.subject,direction.product_visual_state,direction.primary_action,direction.supporting_motion,direction.environment_description,direction.temporal_action?.opening_state,direction.temporal_action?.primary_motion,direction.temporal_action?.physical_interaction,direction.temporal_action?.mid_shot_progression,direction.temporal_action?.ending_state].filter(Boolean).join(' '));
const explicitlyMentions=(text:string,rule:string)=>{const phrase=normalized(rule);if(phrase.length<4)return false;if(text.includes(phrase))return true;const tokens=phrase.split(' ').filter(token=>token.length>3);return tokens.length>1&&tokens.every(token=>text.includes(token));};
const explicitlyShows=(text:string,rule:string)=>{const phrase=normalized(rule);if(!explicitlyMentions(text,rule))return false;const escaped=phrase.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return !new RegExp(`(?:no|without|absent|missing|omit(?:s|ted)?|exclud(?:e|es|ed)|not installed)\\s+(?:the\\s+)?${escaped}|${escaped}\\s+(?:is\\s+)?(?:absent|missing|not installed|excluded|omitted)`,`i`).test(text);};
const stageFor=(handoff:VisualProductionHandoffV2,plan:PlannedScene)=>handoff.production_stages.find(stage=>stage.stage_id===plan.stage_id);
const beatFor=(handoff:VisualProductionHandoffV2,plan:PlannedScene)=>beats(handoff).find(beat=>beat.beat_id===plan.beat_id);

export function structuredPlanFindings(topic:TopicBrief|null,plan:PlannedScene):ValidationFinding[]{
  const handoff=handoffFor(topic);if(!handoff)return [];
  const contract=resolveSceneContract(topic,plan),result:ValidationFinding[]=[],stage=contract.stage,beat=contract.beat,environment=contract.environment;
  if(!stage)result.push(finding(plan.number,'UNKNOWN_STAGE_ID','BLOCKING_ERROR',`Assigned stage ${plan.stage_id} does not exist.`,{structuredRuleSource:'production_stages',expected:'existing stage_id',actual:plan.stage_id,repairHint:'Select an Engine-defined stage.'}));
  if(plan.alignment_source==='ENGINE_BEAT'&&!beat)result.push(finding(plan.number,'UNKNOWN_BEAT_ID','BLOCKING_ERROR',`Assigned beat ${plan.beat_id} does not exist.`,{structuredRuleSource:'visual_story_plan.chapters[].visual_beats',expected:'existing beat_id',actual:plan.beat_id,repairHint:'Select an Engine-defined generated beat.'}));
  if(!environment)result.push(finding(plan.number,'UNKNOWN_ENVIRONMENT_ID','BLOCKING_ERROR',`Assigned environment ${plan.environment_ref} does not exist.`,{structuredRuleSource:'environments',expected:'existing environment_id',actual:plan.environment_ref,repairHint:'Use an Engine-defined environment.'}));
  if(beat){
    if(beat.generation_permission!=='T2V_ALLOWED'||!beat.preferred_media_routes.includes('GENERATED_T2V'))result.push(finding(plan.number,'GENERATION_ROUTE_FORBIDDEN','BLOCKING_ERROR','The assigned beat does not permit generated T2V.',{structuredRuleSource:`${beat.beat_id}.generation_permission/preferred_media_routes`,expected:'T2V_ALLOWED + GENERATED_T2V',actual:`${beat.generation_permission} + ${beat.preferred_media_routes.join(', ')}`,repairHint:'Use an Engine-authorized generated alternative.'}));
    if(beat.applicable_stage_ids.length&&!beat.applicable_stage_ids.includes(plan.stage_id))result.push(finding(plan.number,'BEAT_STAGE_MISMATCH','BLOCKING_ERROR',`Beat ${beat.beat_id} does not allow stage ${plan.stage_id}.`,{structuredRuleSource:`${beat.beat_id}.applicable_stage_ids`,expected:beat.applicable_stage_ids,actual:plan.stage_id,repairHint:'Use one of the beat\'s applicable stages.'}));
    if(contract.state&&contract.state!==plan.state)result.push(finding(plan.number,'SCENE_STATE_MISMATCH','BLOCKING_ERROR','The planned state conflicts with the authoritative scene contract.',{structuredRuleSource:contract.resolutionSources.state==='BEAT'?`${beat.beat_id}.required_product_state_code`:`${stage?.stage_id}.product_state_code`,expected:contract.state,actual:plan.state,repairHint:'Use the state resolved from the assigned beat or stage fallback.'}));
  }
  if(!beat&&stage&&contract.state&&contract.state!==plan.state)result.push(finding(plan.number,'SCENE_STATE_MISMATCH','BLOCKING_ERROR','The planned state conflicts with the authoritative scene contract.',{structuredRuleSource:`${stage.stage_id}.product_state_code`,expected:contract.state,actual:plan.state,repairHint:'Use the stage fallback state.'}));
  if(contract.allowedEnvironmentIds.length&&!sceneEnvironmentAllowed(contract,plan.environment_ref))result.push(finding(plan.number,'SCENE_ENVIRONMENT_NOT_ALLOWED','BLOCKING_ERROR',`Environment ${plan.environment_ref} is not allowed by the resolved scene contract.`,{structuredRuleSource:contract.resolutionSources.environment==='BEAT'?`${beat?.beat_id}.environment_ids`:`${stage?.stage_id}.environment_ids`,expected:contract.allowedEnvironmentIds,actual:plan.environment_ref,repairHint:`Use one of the ${contract.resolutionSources.environment.toLowerCase()}-authorized environments.`,constraintSource:contract.resolutionSources.environment,allowedEnvironmentIds:[...contract.allowedEnvironmentIds],actualEnvironmentId:plan.environment_ref,beatId:contract.beatId,stageId:contract.stageId}));
  return result;
}

export function structuredDirectionFindings(topic:TopicBrief|null,direction:SceneDirection,scene:TimedScene,plan:PlannedScene,generationDurationSeconds:number):ValidationFinding[]{
  const structural=validateSceneDirections([direction],[scene],[plan],generationDurationSeconds).map(message=>finding(direction.number,'MALFORMED_OR_MUTATED_DIRECTION','BLOCKING_ERROR',message,{structuredRuleSource:'scene direction contract',expected:'complete immutable direction fields',actual:message,repairHint:'Return every required creative field without modifying authoritative metadata.'}));
  const handoff=handoffFor(topic);if(!handoff)return [...structuredPlanFindings(topic,plan),...structural];
  const contract=resolveSceneContract(topic,plan),stage=contract.stage,beat=contract.beat,text=creativeText(direction),result=[...structuredPlanFindings(topic,plan),...structural];if(!stage)return result;
  stage.not_yet_installed.forEach(component=>{if(explicitlyShows(text,component))result.push(finding(direction.number,'COMPONENT_PRESENT_TOO_EARLY','BLOCKING_ERROR',`${component} appears before its structured installation stage.`,{structuredRuleSource:`${stage.stage_id}.not_yet_installed`,expected:`${component} absent`,actual:`Direction explicitly includes ${component}`,repairHint:`Remove ${component} and preserve only present_now components.`}));});
  const forbidden=contract.forbiddenElements;
  forbidden.forEach(rule=>{if(explicitlyShows(text,rule))result.push(finding(direction.number,'EXPLICIT_FORBIDDEN_VISUAL','BLOCKING_ERROR',`Direction includes an explicitly forbidden visual: ${rule}.`,{structuredRuleSource:beat?.must_not_show.includes(rule)?`${beat.beat_id}.must_not_show`:`${stage.stage_id}.geometry_control`,expected:`${rule} absent`,actual:`Direction explicitly includes ${rule}`,repairHint:`Remove the prohibited visual while retaining the assigned action.`}));});
  handoff.product.visually_similar_products_to_avoid.forEach(product=>{if(explicitlyMentions(text,product))result.push(finding(direction.number,'WRONG_PRODUCT_OR_VARIANT','BLOCKING_ERROR',`Direction explicitly names prohibited substitute ${product}.`,{structuredRuleSource:'product.visually_similar_products_to_avoid',expected:handoff.product.exact_variant||handoff.product.official_name,actual:product,repairHint:'Use the exact authoritative product identity.'}));});
  const environment=contract.environment,exactName=environment?.exact_facility_name_if_verified?.trim();
  if(exactName&&explicitlyMentions(text,exactName)&&(!beat||!beat.exact_factory_claim_allowed))result.push(finding(direction.number,'EXACT_FACILITY_CLAIM_FORBIDDEN','BLOCKING_ERROR','Direction makes an exact facility claim where only contextual visuals are allowed.',{structuredRuleSource:beat?`${beat.beat_id}.exact_factory_claim_allowed`:'VO_FALLBACK facility policy',expected:'generic/contextual facility',actual:exactName,repairHint:'Remove the exact facility identity.'}));
  return result;
}

export function semanticDirectionFindings(direction:SceneDirection,afterRepair=false):ValidationFinding[]{
  return directionSemanticIssues(direction).map(code=>finding(direction.number,code,afterRepair?'WARNING':'REPAIRABLE_ERROR',afterRepair?`Semantic concern remained after bounded correction and is advisory because no structured rule is violated.`:`Direction has a semantic quality concern that should be corrected automatically.`,{actual:code,repairHint:'Clarify the visible action and alignment claim without changing structured metadata.'}));
}

export function stageChronologyFindings(plans:PlannedScene[],topic:TopicBrief|null):ValidationFinding[]{
  const handoff=handoffFor(topic);if(!handoff)return [];
  const previewFunctions=new Set(['OPENING_HOOK','PREVIEW_PAYOFF','PROVIDE_CONTEXT','COMPARE_SYSTEMS']),result:ValidationFinding[]=[];
  for(let index=1;index<plans.length;index++){const prior=plans[index-1],current=plans[index],priorStage=stageFor(handoff,prior),currentStage=stageFor(handoff,current);if(!priorStage||!currentStage||currentStage.stage_number>=priorStage.stage_number)continue;if(previewFunctions.has(String(prior.story_function))||previewFunctions.has(String(current.story_function)))continue;
    if(prior.visual_family==='ASSEMBLY_PROCESS'&&current.visual_family==='ASSEMBLY_PROCESS')result.push(finding(current.number,'SEQUENTIAL_STAGE_REGRESSION','WARNING','A likely sequential manufacturing run moves backward in structured stage order.',{structuredRuleSource:'production_stages[].stage_number',expected:`stage >= ${priorStage.stage_number}`,actual:currentStage.stage_number,repairHint:'Review whether this is an intentional documentary flashback; otherwise restore sequential manufacturing order.'}));
  }
  return result;
}
