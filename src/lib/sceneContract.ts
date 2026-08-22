import type { AppState, PlannedScene, SceneDirection, TopicBrief } from '../types';
import type { FacilityClaimStatus, GenerationPermission, MediaRoute, ProductStateCode, ProductVisibility, StoryFunction, V2Chapter, V2Environment, V2GeometryModule, V2ProductionStage, V2ReferenceAsset, V2VisualBeat, VisualFamily, VisualProductionHandoffV2 } from '../types/visualProductionV2';

export const SCENE_CONTRACT_RESOLVER_VERSION=1;
export type SceneConstraintSource='BEAT'|'STAGE'|'GLOBAL'|'PLAN'|'NONE';

export interface HandoffIndex {
  handoff:VisualProductionHandoffV2;
  stageById:Map<string,V2ProductionStage>;
  beatById:Map<string,V2VisualBeat>;
  chapterById:Map<string,V2Chapter>;
  chapterByBeatId:Map<string,V2Chapter>;
  environmentById:Map<string,V2Environment>;
  referenceAssetById:Map<string,V2ReferenceAsset>;
  geometryModuleById:Map<string,V2GeometryModule>;
}

export interface ResolvedSceneContract {
  resolverVersion:number;
  sceneNumber:number;
  chapterId:string|null;
  beatId:string|null;
  stageId:string|null;
  visualFamily:VisualFamily|string;
  storyFunction:StoryFunction|string|null;
  visualTreatment:string|null;
  state:ProductStateCode|null;
  allowedEnvironmentIds:string[];
  selectedEnvironmentId:string|null;
  productVisibility:ProductVisibility|string|null;
  facilityClaimStatus:FacilityClaimStatus|null;
  generationPermission:GenerationPermission|null;
  preferredMediaRoutes:MediaRoute[];
  referenceAssetIds:string[];
  requiredVisibleFeatures:string[];
  forbiddenElements:string[];
  continuityRequirements:string[];
  preferredShotScales:string[];
  preferredCameraMovements:string[];
  geometryModuleIds:string[];
  stage:V2ProductionStage|null;
  beat:V2VisualBeat|null;
  environment:V2Environment|null;
  referenceAssets:V2ReferenceAsset[];
  geometryModules:V2GeometryModule[];
  resolutionSources:{environment:SceneConstraintSource;state:SceneConstraintSource;visualFamily:SceneConstraintSource;productVisibility:SceneConstraintSource;references:SceneConstraintSource;camera:SceneConstraintSource};
}

type SceneContractInput=Pick<PlannedScene,'number'|'chapter_id'|'beat_id'|'stage_id'|'environment_ref'|'visual_family'|'story_function'|'visual_treatment'|'product_visibility'|'state'|'reference_asset_ids'|'required_visible_features'|'forbidden_elements'|'continuity_requirements'> & {contract_beat_id?:string};

const indexCache=new WeakMap<object,HandoffIndex>();
const strings=(value:unknown):string[]=>Array.isArray(value)?value.filter((item):item is string=>typeof item==='string').map(item=>item.trim()).filter(Boolean):[];
const unique=(...values:unknown[]):string[]=>{const seen=new Set<string>();return values.flatMap(strings).filter(value=>{const key=value.toLowerCase();if(seen.has(key))return false;seen.add(key);return true;});};
const nonEmpty=(preferred:unknown,fallback:unknown):{values:string[];source:'BEAT'|'STAGE'|'NONE'}=>{const beat=strings(preferred);if(beat.length)return {values:beat,source:'BEAT'};const stage=strings(fallback);return {values:stage,source:stage.length?'STAGE':'NONE'};};

export function v2HandoffFor(topic:TopicBrief|null|undefined):VisualProductionHandoffV2|null{
  const value=(topic as any)?._production_handoff;
  return value?.schema?.version==='2.0.0'?value as VisualProductionHandoffV2:null;
}

export function indexVisualProductionHandoff(handoff:VisualProductionHandoffV2):HandoffIndex{
  const cached=indexCache.get(handoff);if(cached)return cached;
  const chapters=handoff.visual_story_plan?.chapters||[],beats=chapters.flatMap(chapter=>chapter.visual_beats||[]);
  const index:HandoffIndex={handoff,stageById:new Map((handoff.production_stages||[]).map(item=>[item.stage_id,item])),beatById:new Map(beats.map(item=>[item.beat_id,item])),chapterById:new Map(chapters.map(item=>[item.chapter_id,item])),chapterByBeatId:new Map(chapters.flatMap(chapter=>(chapter.visual_beats||[]).map(beat=>[beat.beat_id,chapter] as const))),environmentById:new Map((handoff.environments||[]).map(item=>[item.environment_id,item])),referenceAssetById:new Map((handoff.reference_assets||[]).map(item=>[item.asset_id,item])),geometryModuleById:new Map((handoff.geometry_modules||[]).map(item=>[item.module_id,item]))};
  indexCache.set(handoff,index);return index;
}

export function resolveSceneContract(topic:TopicBrief|null|undefined,input:SceneContractInput|SceneDirection):ResolvedSceneContract{
  const handoff=v2HandoffFor(topic),sceneNumber=Number(input.number),contractBeatId=Object.prototype.hasOwnProperty.call(input,'contract_beat_id')?((input as any).contract_beat_id||null):(input.beat_id||null);
  if(!handoff)return {resolverVersion:SCENE_CONTRACT_RESOLVER_VERSION,sceneNumber,chapterId:input.chapter_id||null,beatId:contractBeatId,stageId:input.stage_id||null,visualFamily:input.visual_family||'',storyFunction:input.story_function||null,visualTreatment:input.visual_treatment||null,state:input.state||null,allowedEnvironmentIds:input.environment_ref?[input.environment_ref]:[],selectedEnvironmentId:input.environment_ref||null,productVisibility:input.product_visibility||null,facilityClaimStatus:null,generationPermission:null,preferredMediaRoutes:[],referenceAssetIds:unique(input.reference_asset_ids),requiredVisibleFeatures:unique(input.required_visible_features),forbiddenElements:unique(input.forbidden_elements),continuityRequirements:unique((input as any).continuity_requirements),preferredShotScales:[],preferredCameraMovements:[],geometryModuleIds:[],stage:null,beat:null,environment:null,referenceAssets:[],geometryModules:[],resolutionSources:{environment:input.environment_ref?'PLAN':'NONE',state:input.state?'PLAN':'NONE',visualFamily:input.visual_family?'PLAN':'NONE',productVisibility:input.product_visibility?'PLAN':'NONE',references:(input.reference_asset_ids||[]).length?'PLAN':'NONE',camera:'NONE'}};
  const index=indexVisualProductionHandoff(handoff),stage=index.stageById.get(input.stage_id)||null,beat=index.beatById.get(contractBeatId)||null;
  const environmentChoice=nonEmpty(beat?.environment_ids,stage?.environment_ids),allowedEnvironmentIds=environmentChoice.values;
  const selectedEnvironmentId=input.environment_ref||allowedEnvironmentIds[0]||null,environment=selectedEnvironmentId?index.environmentById.get(selectedEnvironmentId)||null:null;
  const state=beat?.required_product_state_code||stage?.product_state_code||input.state||null;
  const stateSource:SceneConstraintSource=beat?.required_product_state_code?'BEAT':stage?.product_state_code?'STAGE':input.state?'PLAN':'NONE';
  const references=nonEmpty(beat?.reference_asset_ids,stage?.visual_evidence?.reference_asset_ids);
  const cameraScales=nonEmpty(beat?.preferred_shot_scales,stage?.camera_guidance?.safe_shot_scales),cameraMovements=nonEmpty(beat?.preferred_camera_movements,stage?.camera_guidance?.preferred_camera_movements);
  const geometryModuleIds=unique([stage?.geometry_control?.primary_geometry_module_id],stage?.geometry_control?.secondary_geometry_module_ids);
  const requiredVisibleFeatures=unique(beat?.must_show?.length?beat.must_show:stage?.geometry_control?.required_visible_anchors,input.required_visible_features);
  const forbiddenElements=unique(beat?.must_not_show,beat?.negative_constraints,stage?.geometry_control?.negative_constraints,stage?.geometry_control?.forbidden_transformations,stage?.stage_actions?.flatMap(action=>action.forbidden_actions),environment?.forbidden_elements,handoff.product.global_negative_constraints,input.forbidden_elements);
  const continuityRequirements=unique(beat?.continuity_requirements?.length?beat.continuity_requirements:stage?.continuity?.features_that_must_remain_consistent,(input as any).continuity_requirements);
  const referenceAssetIds=references.values,referenceAssets=referenceAssetIds.map(id=>index.referenceAssetById.get(id)).filter(Boolean) as V2ReferenceAsset[];
  const geometryModules=geometryModuleIds.map(id=>index.geometryModuleById.get(id)).filter(Boolean) as V2GeometryModule[];
  return {resolverVersion:SCENE_CONTRACT_RESOLVER_VERSION,sceneNumber,chapterId:input.chapter_id||index.chapterByBeatId.get(contractBeatId)?.chapter_id||null,beatId:beat?.beat_id||contractBeatId,stageId:stage?.stage_id||input.stage_id||null,visualFamily:beat?.visual_family||input.visual_family||'',storyFunction:beat?.story_function||input.story_function||null,visualTreatment:input.visual_treatment||null,state,allowedEnvironmentIds,selectedEnvironmentId,productVisibility:beat?.product_visibility||input.product_visibility||null,facilityClaimStatus:beat?.facility_claim_status||environment?.facility_claim_status||null,generationPermission:beat?.generation_permission||null,preferredMediaRoutes:beat?.preferred_media_routes||[],referenceAssetIds,requiredVisibleFeatures,forbiddenElements,continuityRequirements,preferredShotScales:cameraScales.values,preferredCameraMovements:cameraMovements.values,geometryModuleIds,stage,beat,environment,referenceAssets,geometryModules,resolutionSources:{environment:environmentChoice.source,state:stateSource,visualFamily:beat?'BEAT':input.visual_family?'PLAN':'NONE',productVisibility:beat?'BEAT':input.product_visibility?'PLAN':'NONE',references:references.source,camera:cameraScales.source!=='NONE'?cameraScales.source:cameraMovements.source}};
}

export const sceneEnvironmentAllowed=(contract:ResolvedSceneContract,environmentId:string|null|undefined)=>Boolean(environmentId)&&(!contract.allowedEnvironmentIds.length||contract.allowedEnvironmentIds.includes(String(environmentId)));

export function applyResolvedSceneContract(topic:TopicBrief|null|undefined,plan:PlannedScene,contractBeatId=plan.contract_beat_id||plan.beat_id):PlannedScene{
  const contract=resolveSceneContract(topic,{...plan,contract_beat_id:contractBeatId});
  return {...plan,contract_beat_id:contract.beat?.beat_id||contractBeatId,constraint_resolver_version:contract.resolverVersion,constraint_sources:{...contract.resolutionSources},allowed_environment_ids:[...contract.allowedEnvironmentIds],chapter_id:contract.chapterId||plan.chapter_id,stage_id:contract.stageId||plan.stage_id,environment_ref:contract.selectedEnvironmentId||plan.environment_ref,visual_family:contract.visualFamily as PlannedScene['visual_family'],story_function:(contract.storyFunction||plan.story_function) as PlannedScene['story_function'],product_visibility:(contract.productVisibility||plan.product_visibility) as PlannedScene['product_visibility'],state:contract.state||plan.state,reference_asset_ids:[...contract.referenceAssetIds],required_visible_features:[...contract.requiredVisibleFeatures],forbidden_elements:[...contract.forbiddenElements],continuity_requirements:[...contract.continuityRequirements]};
}

const environmentRepairCodes=new Set(['STAGE_ENVIRONMENT_MISMATCH','BEAT_ENVIRONMENT_MISMATCH','SCENE_ENVIRONMENT_NOT_ALLOWED']);
export function clearResolvedEnvironmentRepairs(state:AppState):{state:AppState;clearedSceneNumbers:number[]}{
  const clearedSceneNumbers:number[]=[];
  const deferredRepairs=state.generationSession.deferredRepairs.filter(repair=>{
    if(!environmentRepairCodes.has(repair.validationCode))return true;
    const plan=state.plannedScenes.find(item=>item.number===repair.sceneNumber),direction=state.sceneDirections.find(item=>item.number===repair.sceneNumber);if(!plan||!direction)return true;
    const contract=resolveSceneContract(state.topic,plan),valid=sceneEnvironmentAllowed(contract,plan.environment_ref)&&direction.environment_ref===plan.environment_ref;
    if(valid)clearedSceneNumbers.push(repair.sceneNumber);return !valid;
  });
  const sceneReviews=state.generationSession.sceneReviews.filter(review=>{
    if(review.operation!=='DIRECTION'||!review.validationCodes.length||!review.validationCodes.every(code=>environmentRepairCodes.has(code)))return true;
    const plan=state.plannedScenes.find(item=>item.number===review.sceneNumber),direction=state.sceneDirections.find(item=>item.number===review.sceneNumber);if(!plan||!direction)return true;
    const contract=resolveSceneContract(state.topic,plan),valid=sceneEnvironmentAllowed(contract,plan.environment_ref)&&direction.environment_ref===plan.environment_ref;if(valid)clearedSceneNumbers.push(review.sceneNumber);return !valid;
  });
  if(!clearedSceneNumbers.length)return {state,clearedSceneNumbers};
  return {state:{...state,generationSession:{...state.generationSession,sceneReviews,deferredRepairs,correctionPendingSceneNumbers:state.generationSession.correctionPendingSceneNumbers.filter(number=>!clearedSceneNumbers.includes(number)),validationWarnings:state.generationSession.validationWarnings.filter(item=>!clearedSceneNumbers.includes(item.sceneNumber)||!environmentRepairCodes.has(item.code))}},clearedSceneNumbers:[...new Set(clearedSceneNumbers)].sort((a,b)=>a-b)};
}
