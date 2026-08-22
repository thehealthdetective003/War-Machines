import type { PlannedScene, SceneDirection, TimedScene, TopicBrief, VisualFamily } from '../types';
import type { V2ReferenceAsset, V2VisualBeat } from '../types/visualProductionV2';
import { applyResolvedSceneContract } from './sceneContract';

/** Closed-schema values retained only so legacy imports can be recognized and normalized. */
export const LEGACY_GRAPHIC_VISUAL_FAMILIES=new Set<string>(['TECHNICAL_GRAPHIC','MAP_OR_SUPPLY_CHAIN']);
export const LEGACY_GRAPHIC_TREATMENTS=new Set<string>(['STATIC_GRAPHIC_T2V','MOTION_GRAPHIC_T2V']);
const CINEMATIC_FAMILIES=new Set<VisualFamily>(['FACTORY_AERIAL','FACTORY_EXTERIOR','FACILITY_APPROACH','FACTORY_INTERIOR_WIDE','MATERIAL_FLOW','COMPONENT_LOGISTICS','ASSEMBLY_PROCESS','COMPONENT_MACRO','TOOL_LEVEL_DETAIL','WORKER_POV','MACHINERY_ACTION','QUALITY_CONTROL','MEASUREMENT_AND_CALIBRATION','ENVIRONMENTAL_TESTING','STATIC_GROUND_TEST','DYNAMIC_TESTING','DELIVERY_AND_ROLLOUT','OPERATIONAL_CONTEXT','ARCHIVAL_REFERENCE','HERO_PRODUCT','CHAPTER_TRANSITION','ATMOSPHERIC_INTERSTITIAL']);
const GRAPHIC_LANGUAGE=/\b(technical graphic|motion graphic|diagram|schematic|infographic|blueprint|vector|floating (?:arrow|label)|flow line|graphic overlay|fake ui|hud|map animation|abstract visualization)\b/i;
const stop=new Set(['the','and','that','this','with','from','into','while','through','about','then','than','only','also','have','has','had','does','not','scene','show','visual','product','system']);
const tokens=(value:string)=>new Set((value.toLowerCase().match(/[a-z0-9]{3,}/g)||[]).filter(value=>!stop.has(value)));
const overlap=(a:Set<string>,b:Set<string>)=>[...a].filter(value=>b.has(value)).length;
const strings=(value:unknown)=>Array.isArray(value)?value.map(String).map(item=>item.trim()).filter(Boolean):[];
const unique=(values:string[])=>[...new Set(values.map(value=>value.trim()).filter(Boolean))];
const handoffFor=(topic:TopicBrief|null|undefined)=>(topic as any)?._production_handoff as any;
const stageState=(topic:TopicBrief|null|undefined,stageId:string,fallback:'A'|'B'|'C')=>{const value=String(handoffFor(topic)?.production_stages?.find((item:any)=>item.stage_id===stageId)?.product_state_code||'');return value==='A'||value==='B'||value==='C'?value:fallback;};

export const isLegacyGraphicFamily=(value:unknown)=>LEGACY_GRAPHIC_VISUAL_FAMILIES.has(String(value||''));
export const isLegacyGraphicTreatment=(value:unknown)=>LEGACY_GRAPHIC_TREATMENTS.has(String(value||''));
export const isLegacyGraphicEnvironmentRecord=(environment:any)=>Boolean(environment)&&(String(environment.setting_scope||'')==='GRAPHIC_SPACE'||/\b(graphic|diagram|schematic|infographic|vector|editorial canvas)\b/i.test(`${environment.environment_id||''} ${environment.environment_name||''} ${environment.facility_type||''}`));
export const isLegacyGraphicEnvironment=(topic:TopicBrief|null|undefined,environmentId:unknown)=>{const id=String(environmentId||'');if(!id)return false;const handoff=handoffFor(topic),environment=handoff?.environments?.find((item:any)=>item.environment_id===id);return isLegacyGraphicEnvironmentRecord(environment)||/\b(?:ENV_)?(?:TECHNICAL_)?GRAPHIC\b|DIAGRAM|SCHEMATIC/i.test(id);};
export const isLegacyGraphicBeat=(topic:TopicBrief|null|undefined,beat:V2VisualBeat|undefined|null)=>Boolean(beat)&&(isLegacyGraphicFamily(beat!.visual_family)||strings(beat!.environment_ids).some(id=>isLegacyGraphicEnvironment(topic,id))||strings(beat!.preferred_media_routes).some(route=>route==='EDITOR_NATIVE_GRAPHIC'||route==='REFERENCE_LOCKED_GRAPHIC'));
export const hasActiveGraphicConfiguration=(topic:TopicBrief|null|undefined,item:Pick<PlannedScene,'visual_family'|'visual_treatment'|'environment_ref'|'graphic_spec'>|Pick<SceneDirection,'visual_family'|'visual_treatment'|'environment_ref'|'graphic_spec'>)=>isLegacyGraphicFamily(item.visual_family)||isLegacyGraphicTreatment(item.visual_treatment)||Boolean(item.graphic_spec)||isLegacyGraphicEnvironment(topic,item.environment_ref);

const safeReferenceAssets=(topic:TopicBrief|null|undefined,ids:string[]):V2ReferenceAsset[]=>{const handoff=handoffFor(topic);return ids.map(id=>handoff?.reference_assets?.find((item:any)=>item.asset_id===id)).filter((item:any):item is V2ReferenceAsset=>Boolean(item)&&item.visual_verification!=='FAIL'&&!['DIAGRAM','MAP'].includes(item.asset_type));};
const safeEnvironmentIds=(topic:TopicBrief|null|undefined,ids:string[])=>ids.filter(id=>!isLegacyGraphicEnvironment(topic,id));
const allBeats=(topic:TopicBrief|null|undefined):Array<{chapterId:string;beat:V2VisualBeat}>=>{const handoff=handoffFor(topic);return (handoff?.visual_story_plan?.chapters||[]).flatMap((chapter:any)=>(chapter.visual_beats||[]).map((beat:V2VisualBeat)=>({chapterId:chapter.chapter_id,beat})));};
export const cinematicGenerationBeats=(topic:TopicBrief|null|undefined)=>allBeats(topic).filter(({beat})=>beat.generation_permission==='T2V_ALLOWED'&&beat.preferred_media_routes?.includes('GENERATED_T2V')&&!isLegacyGraphicBeat(topic,beat));

function preferredFamilies(scene:TimedScene,plan:PlannedScene,hasReference:boolean):VisualFamily[]{
  const value=`${scene.text} ${plan.alignment_claim||''} ${plan.story_function}`.toLowerCase();
  if(hasReference)return ['ARCHIVAL_REFERENCE','COMPONENT_MACRO','HERO_PRODUCT'];
  if(plan.story_function==='CONCLUDE_CHAPTER'||plan.story_function==='BRIDGE_STAGE'||/\b(chapter|transition|bridge|meanwhile|next stage)\b/.test(value))return ['ATMOSPHERIC_INTERSTITIAL','COMPONENT_MACRO','FACTORY_INTERIOR_WIDE','HERO_PRODUCT'];
  if(/\b(test|load|stress|calibrat|measure|verify|inspect|quality|alignment)\b/.test(value))return ['MEASUREMENT_AND_CALIBRATION','QUALITY_CONTROL','STATIC_GROUND_TEST','ENVIRONMENTAL_TESTING','COMPONENT_MACRO'];
  if(/\b(logistics|supply|route|move|transport|deliver|material flow)\b/.test(value))return ['COMPONENT_LOGISTICS','MATERIAL_FLOW','FACILITY_APPROACH','FACTORY_INTERIOR_WIDE'];
  if(/\b(hidden|internal|inside|mechanism|relationship|interface|geometry|flow|network|system|compare|difference|scale)\b/.test(value))return ['COMPONENT_MACRO','QUALITY_CONTROL','MEASUREMENT_AND_CALIBRATION','TOOL_LEVEL_DETAIL','ATMOSPHERIC_INTERSTITIAL'];
  if(plan.state==='C')return ['OPERATIONAL_CONTEXT','HERO_PRODUCT','DYNAMIC_TESTING','DELIVERY_AND_ROLLOUT','COMPONENT_MACRO'];
  if(plan.state==='A')return ['MATERIAL_FLOW','COMPONENT_LOGISTICS','FACTORY_INTERIOR_WIDE','COMPONENT_MACRO'];
  return ['ASSEMBLY_PROCESS','MACHINERY_ACTION','COMPONENT_MACRO','QUALITY_CONTROL','WORKER_POV'];
}

function physicalEvidence(topic:TopicBrief|null|undefined,plan:PlannedScene,assets:V2ReferenceAsset[]):string[]{
  const handoff=handoffFor(topic),stage=handoff?.production_stages?.find((item:any)=>item.stage_id===plan.stage_id);
  return unique([
    ...assets.flatMap(asset=>asset.visible_geometry_features||[]),
    ...strings(stage?.visual_evidence?.confirmed_visual_details),
    ...strings(stage?.present_now),...strings(stage?.temporarily_exposed),...strings(stage?.open_interfaces),
    ...strings(stage?.stage_visual_opportunities?.component_macro_opportunities),
    ...strings(stage?.stage_visual_opportunities?.quality_control_opportunities),
    ...strings(plan.required_visible_features).filter(value=>!GRAPHIC_LANGUAGE.test(value)),
  ]);
}

function fallbackFamily(scene:TimedScene,plan:PlannedScene,preferred:VisualFamily[]):VisualFamily{
  const supported=preferred.find(family=>CINEMATIC_FAMILIES.has(family));if(supported)return supported;
  return plan.state==='C'?'HERO_PRODUCT':scene.silent?'ATMOSPHERIC_INTERSTITIAL':'COMPONENT_MACRO';
}

function safeEnvironment(topic:TopicBrief|null|undefined,plan:PlannedScene,beat?:V2VisualBeat):string{
  const handoff=handoffFor(topic),stage=handoff?.production_stages?.find((item:any)=>item.stage_id===plan.stage_id);
  return safeEnvironmentIds(topic,[...(beat?.environment_ids||[]),...(stage?.environment_ids||[]),plan.environment_ref,...(handoff?.environments||[]).map((item:any)=>item.environment_id)])[0]||'';
}

/** Converts a legacy graphic route into a physical, evidence-safe scene before any paid direction call. */
export function resolveCinematicAlternative(topic:TopicBrief|null|undefined,scene:TimedScene,plan:PlannedScene):PlannedScene{
  if(!hasActiveGraphicConfiguration(topic,plan))return {...plan,visual_treatment:'LIVE_ACTION_T2V',graphic_spec:null};
  const handoff=handoffFor(topic),sourceBeat=allBeats(topic).find(({beat})=>beat.beat_id===(plan.contract_beat_id||plan.beat_id))?.beat;
  const assets=safeReferenceAssets(topic,unique([...(plan.reference_asset_ids||[]),...(sourceBeat?.reference_asset_ids||[])])),evidence=physicalEvidence(topic,plan,assets),preferred=preferredFamilies(scene,plan,assets.length>0),semantic=tokens(`${scene.text} ${plan.alignment_claim||''} ${sourceBeat?.narrative_purpose||''} ${(sourceBeat?.semantic_alignment_terms||[]).join(' ')}`);
  const candidates=cinematicGenerationBeats(topic).map(candidate=>{
    const beat=candidate.beat,stageMatch=beat.applicable_stage_ids?.includes(plan.stage_id),state=stageState(topic,stageMatch?plan.stage_id:(beat.applicable_stage_ids?.[0]||plan.stage_id),plan.state),candidateTokens=tokens(`${beat.beat_name} ${beat.narrative_purpose} ${(beat.semantic_alignment_terms||[]).join(' ')} ${(beat.must_show||[]).join(' ')}`),familyRank=preferred.indexOf(beat.visual_family);
    let score=overlap(semantic,candidateTokens)*14+(candidate.chapterId===plan.chapter_id?14:0)+(stageMatch?24:0)+(state===plan.state?18:0)+(beat.story_function===plan.story_function?8:0)+(familyRank>=0?30-familyRank*4:0);
    if(beat.visual_family==='ARCHIVAL_REFERENCE'&&assets.length)score+=35;if(!safeEnvironmentIds(topic,beat.environment_ids||[]).length)score-=40;
    return {...candidate,score};
  }).sort((a,b)=>b.score-a.score||a.beat.beat_order-b.beat.beat_order);
  const chosen=candidates[0]?.score>0?candidates[0]:undefined,beat=chosen?.beat,family=beat?.visual_family||fallbackFamily(scene,plan,preferred),stage=beat?.applicable_stage_ids?.includes(plan.stage_id)?plan.stage_id:(beat?.applicable_stage_ids?.[0]||plan.stage_id),environment=safeEnvironment(topic,{...plan,stage_id:stage},beat),visibility=beat?.product_visibility||(family==='ATMOSPHERIC_INTERSTITIAL'?'NONE':family==='COMPONENT_MACRO'||family==='TOOL_LEVEL_DETAIL'?'DETAIL_ONLY':plan.product_visibility),verified=evidence[0]||String(handoff?.product?.overall_visual_description||handoff?.product?.official_name||topic?.topic?.product||'the externally visible documented subject'),claim=beat?.narrative_purpose||`Use cinematic complementary imagery of ${verified}; show only externally visible, evidence-supported details while narration carries the abstract explanation.`;
  let next:PlannedScene={...plan,chapter_id:chosen?.chapterId||plan.chapter_id,beat_id:beat?.beat_id||`${plan.beat_id}__CINEMATIC`,contract_beat_id:beat?.beat_id,visual_family:family,story_function:beat?.story_function||(plan.story_function==='EXPLAIN_HIDDEN_SYSTEM'?'PROVIDE_CONTEXT':plan.story_function),visual_treatment:'LIVE_ACTION_T2V',product_visibility:visibility,stage_id:stage,environment_ref:environment,state:stageState(topic,stage,plan.state),graphic_spec:null,reference_asset_ids:unique([...(beat?.reference_asset_ids||[]),...assets.map(asset=>asset.asset_id)]),required_visible_features:unique([...(beat?.must_show||[]),...evidence.slice(0,4)]),forbidden_elements:unique([...(plan.forbidden_elements||[]),...(sourceBeat?.must_not_show||[]),...(sourceBeat?.negative_constraints||[]),...(beat?.must_not_show||[]),...(beat?.negative_constraints||[]),'technical graphics, diagrams, schematics, maps, vector overlays, floating arrows or labels','invented internal mechanisms or unsupported physical processes']),continuity_requirements:unique([...(plan.continuity_requirements||[]),...(beat?.continuity_requirements||[])]),alignment_claim:claim};
  next=applyResolvedSceneContract(topic,next,beat?.beat_id);
  return {...next,visual_family:family,visual_treatment:'LIVE_ACTION_T2V',environment_ref:safeEnvironment(topic,next,beat),allowed_environment_ids:safeEnvironmentIds(topic,next.allowed_environment_ids||[]),graphic_spec:null,alignment_claim:claim,reference_asset_ids:unique([...(next.reference_asset_ids||[]),...assets.map(asset=>asset.asset_id)]),required_visible_features:unique([...(next.required_visible_features||[]),...evidence.slice(0,4)]),forbidden_elements:unique([...(next.forbidden_elements||[]),'technical graphics, diagrams, schematics, maps, vector overlays, floating arrows or labels','invented internal mechanisms or unsupported physical processes'])};
}

export function normalizeCinematicPlans(topic:TopicBrief|null|undefined,scenes:TimedScene[],plans:PlannedScene[],preserveSceneNumbers:Set<number>=new Set()):{plans:PlannedScene[];normalizedSceneNumbers:number[]}{
  const sceneByNumber=new Map(scenes.map(scene=>[scene.number,scene])),normalizedSceneNumbers:number[]=[];
  const next=plans.map(plan=>{if(preserveSceneNumbers.has(plan.number)||!hasActiveGraphicConfiguration(topic,plan))return plan;const scene=sceneByNumber.get(plan.number);if(!scene)return plan;normalizedSceneNumbers.push(plan.number);return resolveCinematicAlternative(topic,scene,plan);});
  return {plans:next,normalizedSceneNumbers};
}

export function normalizeCinematicDirection(topic:TopicBrief|null|undefined,direction:SceneDirection):SceneDirection{
  if(!hasActiveGraphicConfiguration(topic,direction))return direction;
  const verifiedFeatures=direction.required_visible_features.filter(value=>!GRAPHIC_LANGUAGE.test(value)),evidence=verifiedFeatures[0]||direction.subject.replace(GRAPHIC_LANGUAGE,'').trim()||'documented external component detail',environment=safeEnvironment(topic,direction as PlannedScene),graphicEnvironment=isLegacyGraphicEnvironment(topic,direction.environment_ref),family:VisualFamily=direction.product_visibility==='NONE'?'ATMOSPHERIC_INTERSTITIAL':direction.state==='C'?'HERO_PRODUCT':'COMPONENT_MACRO';
  return {...direction,visual_family:family,visual_treatment:'LIVE_ACTION_T2V',environment_ref:environment||(graphicEnvironment?'':direction.environment_ref),environment_description:graphicEnvironment?'Engine-authorized non-identifying physical context':direction.environment_description,lighting_and_material:GRAPHIC_LANGUAGE.test(direction.lighting_and_material)?'Neutral photographic documentary lighting on physically credible materials':direction.lighting_and_material,graphic_spec:null,subject:evidence,primary_action:`The cinematic shot observes ${evidence} in its documented physical state without visualizing unsupported internals`,supporting_motion:'Only verified ambient or handling motion remains visible',required_visible_features:verifiedFeatures.length?verifiedFeatures:[evidence],temporal_action:{opening_state:`${evidence} is established in its documented physical context`,primary_motion:'The externally visible subject remains physically stable while the camera makes one restrained move',physical_interaction:'No unverified internal action is shown',mid_shot_progression:'Lighting and perspective reveal only verified external form and material detail',ending_state:'The same documented subject holds in an unchanged physical state'},forbidden_elements:unique([...direction.forbidden_elements,'technical graphics, diagrams, schematics, maps, vector overlays, floating arrows or labels','invented internal mechanisms or unsupported physical processes'])};
}

export const containsGraphicPromptLanguage=(value:string)=>GRAPHIC_LANGUAGE.test(value.replace(/\b(?:exclude|avoid|without|no)\b[^.!?]*/gi,''));
