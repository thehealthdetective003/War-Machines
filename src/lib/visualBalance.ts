import type { PlannedScene, TimedScene, TopicBrief, VisualFamily, VisualTreatment } from '../types';
import type { V2VisualBeat, V2VisualBalanceTargets, V2VisualStoryPlan } from '../types/visualProductionV2';
import { deriveGraphicSceneSpec, resolvePlannedState } from './scenePlanner';
import { GRAPHIC_VISUAL_FAMILIES, graphicNeedScore } from './visualPolicy';
export { GRAPHIC_VISUAL_FAMILIES, graphicNeedScore, hasStrongGraphicNeed } from './visualPolicy';

const DEFAULT_POLICY={
  maximumConsecutiveSameFamily:2,
  maximumConsecutiveEnvironment:3,
  maximumConsecutiveFullProduct:2,
  minimumFamiliesPerMinute:3,
  graphicsMaximumPercent:15,
  balanceTolerancePercent:3,
  nearbyGraphicDistance:3,
};

const STOP=new Set(['the','and','that','this','with','from','into','while','through','about','then','than','only','also','have','has','had','does','not','scene','show','visual','product','system']);
const stem=(value:string)=>value.length>5?value.replace(/(?:ing|tion|ions|ments|ment|ed|es|s)$/,''):value;
const tokens=(value:string)=>new Set((value.toLowerCase().match(/[a-z0-9]{3,}/g)||[]).map(stem).filter(value=>!STOP.has(value)));
const overlap=(a:Set<string>,b:Set<string>)=>[...a].filter(value=>b.has(value)).length;
const similarity=(a:string,b:string)=>{const left=tokens(a),right=tokens(b),union=new Set([...left,...right]);return union.size?overlap(left,right)/union.size:0;};
const percent=(count:number,total:number)=>total?Number((count*100/total).toFixed(2)):0;

type BalanceCategory=keyof V2VisualBalanceTargets;
const CATEGORY_FAMILIES:Partial<Record<BalanceCategory,Set<VisualFamily>>>={
  manufacturing_and_assembly_percent:new Set(['ASSEMBLY_PROCESS','MACHINERY_ACTION','WORKER_POV','MATERIAL_FLOW']),
  factory_scale_and_logistics_percent:new Set(['FACTORY_AERIAL','FACTORY_EXTERIOR','FACILITY_APPROACH','FACTORY_INTERIOR_WIDE','COMPONENT_LOGISTICS']),
  component_detail_and_quality_control_percent:new Set(['COMPONENT_MACRO','TOOL_LEVEL_DETAIL','QUALITY_CONTROL','MEASUREMENT_AND_CALIBRATION']),
  testing_and_operational_context_percent:new Set(['ENVIRONMENTAL_TESTING','STATIC_GROUND_TEST','DYNAMIC_TESTING','DELIVERY_AND_ROLLOUT','OPERATIONAL_CONTEXT']),
  graphics_and_reference_media_percent:new Set(['TECHNICAL_GRAPHIC','MAP_OR_SUPPLY_CHAIN','ARCHIVAL_REFERENCE']),
  completed_product_hero_imagery_percent:new Set(['HERO_PRODUCT']),
};

export interface LongestVisualRun { family:string; length:number; startScene:number|null; endScene:number|null; }
export interface VisualBalanceDiagnostics {
  totalScenes:number;
  visualFamilyCounts:Record<string,number>;
  visualFamilyPercentages:Record<string,number>;
  technicalGraphicCount:number;
  technicalGraphicPercentage:number;
  longestTechnicalGraphicRun:number;
  longestSameFamilyRun:LongestVisualRun;
  graphicScenesReassigned:number;
  duplicateGraphicClaimsCollapsed:number;
  warnings:string[];
}
export interface VisualBalanceResult { plan:PlannedScene[]; diagnostics:VisualBalanceDiagnostics; }
export interface VisualRebalanceOptions { lockedThroughScene?:number; }

interface Policy {
  maximumConsecutiveSameFamily:number;
  maximumConsecutiveEnvironment:number;
  maximumConsecutiveFullProduct:number;
  minimumFamiliesPerMinute:number;
  graphicsMaximumPercent:number;
  balanceTolerancePercent:number;
  nearbyGraphicDistance:number;
  targets?:V2VisualBalanceTargets;
}
interface BeatCandidate { chapterId:string; beat:V2VisualBeat; }

const handoffStoryPlan=(topic:TopicBrief|null|undefined)=>(topic as any)?._production_handoff?.visual_story_plan as V2VisualStoryPlan|undefined;
const policyFor=(topic:TopicBrief|null|undefined):Policy=>{
  const story=handoffStoryPlan(topic),rhythm=story?.rhythm_policy,targets=story?.visual_balance_targets,configuredGraphicsMaximum=Number(targets?.graphics_and_reference_media_percent?.maximum);
  return {
    maximumConsecutiveSameFamily:Math.max(1,Number(rhythm?.maximum_consecutive_same_visual_family)||DEFAULT_POLICY.maximumConsecutiveSameFamily),
    maximumConsecutiveEnvironment:Math.max(1,Number(rhythm?.maximum_consecutive_same_environment_without_new_information)||DEFAULT_POLICY.maximumConsecutiveEnvironment),
    maximumConsecutiveFullProduct:Math.max(1,Number(rhythm?.maximum_consecutive_full_product_scenes)||DEFAULT_POLICY.maximumConsecutiveFullProduct),
    minimumFamiliesPerMinute:Math.max(1,Number(rhythm?.minimum_meaningful_visual_families_per_60_seconds)||DEFAULT_POLICY.minimumFamiliesPerMinute),
    graphicsMaximumPercent:Number.isFinite(configuredGraphicsMaximum)&&configuredGraphicsMaximum>=0?configuredGraphicsMaximum:DEFAULT_POLICY.graphicsMaximumPercent,
    balanceTolerancePercent:DEFAULT_POLICY.balanceTolerancePercent,
    nearbyGraphicDistance:DEFAULT_POLICY.nearbyGraphicDistance,
    targets,
  };
};

const treatmentFor=(beat:V2VisualBeat):VisualTreatment=>{
  if(!GRAPHIC_VISUAL_FAMILIES.has(beat.visual_family))return 'LIVE_ACTION_T2V';
  const value=`${beat.beat_name} ${beat.narrative_purpose} ${(beat.semantic_alignment_terms||[]).join(' ')}`;
  return /\b(flow|path|sequence|motion|movement|relationship|layer|mechanism|supply|route)\b/i.test(value)?'MOTION_GRAPHIC_T2V':'STATIC_GRAPHIC_T2V';
};
const allowedBeats=(topic:TopicBrief|null|undefined):BeatCandidate[]=>{
  const chapters=handoffStoryPlan(topic)?.chapters||[];
  return chapters.flatMap(chapter=>chapter.visual_beats.map(beat=>({chapterId:chapter.chapter_id,beat})))
    .filter(({beat})=>beat.generation_permission==='T2V_ALLOWED'&&beat.preferred_media_routes?.includes('GENERATED_T2V'));
};
const graphicClaim=(item:PlannedScene)=>`${item.semantic_group_intent||''} ${item.alignment_claim||''} ${item.graphic_spec?.visual_claim||''} ${item.story_function} ${item.beat_id}`;
export const areDuplicateGraphicClaims=(a:PlannedScene,b:PlannedScene)=>a.beat_id===b.beat_id||similarity(graphicClaim(a),graphicClaim(b))>=0.62;

function longestRun<T>(plan:PlannedScene[],value:(item:PlannedScene)=>T,accept?:(item:PlannedScene)=>boolean):LongestVisualRun{
  let best:LongestVisualRun={family:'',length:0,startScene:null,endScene:null},run=0,last:T|undefined,start=0;
  plan.forEach((item,index)=>{const current=value(item),included=accept?accept(item):true;if(included&&run&&current===last)run++;else{run=included?1:0;start=index;}last=included?current:undefined;if(run>best.length)best={family:String(current),length:run,startScene:plan[start]?.number??null,endScene:item.number};});
  return best;
}
const categoryFor=(family:VisualFamily)=>Object.entries(CATEGORY_FAMILIES).find(([,families])=>families?.has(family))?.[0] as BalanceCategory|undefined;

function auditWarnings(topic:TopicBrief|null|undefined,scenes:TimedScene[],plan:PlannedScene[],policy:Policy):string[]{
  const warnings:string[]=[],total=plan.length,graphics=plan.filter(item=>GRAPHIC_VISUAL_FAMILIES.has(item.visual_family));
  const graphPercent=percent(graphics.length,total),familyRun=longestRun(plan,item=>item.visual_family),graphicRun=longestRun(plan,item=>item.visual_family,item=>GRAPHIC_VISUAL_FAMILIES.has(item.visual_family));
  if(graphPercent>policy.graphicsMaximumPercent+policy.balanceTolerancePercent)warnings.push(`Graphic/reference-family allocation is ${graphPercent}% versus the advisory ${policy.graphicsMaximumPercent}% maximum.`);
  if(graphicRun.length>=3)warnings.push(`Technical-graphic run of ${graphicRun.length} scenes starts at scene ${graphicRun.startScene}.`);
  if(familyRun.length>policy.maximumConsecutiveSameFamily)warnings.push(`${familyRun.family} runs for ${familyRun.length} scenes; configured maximum is ${policy.maximumConsecutiveSameFamily}.`);
  const envRun=longestRun(plan,item=>item.environment_ref);if(envRun.length>policy.maximumConsecutiveEnvironment)warnings.push(`${envRun.family} repeats for ${envRun.length} scenes; configured environment maximum is ${policy.maximumConsecutiveEnvironment}.`);
  const fullRun=longestRun(plan,item=>item.product_visibility,item=>item.product_visibility==='FULL');if(fullRun.length>policy.maximumConsecutiveFullProduct)warnings.push(`FULL product visibility repeats for ${fullRun.length} scenes; configured maximum is ${policy.maximumConsecutiveFullProduct}.`);
  graphics.forEach((item,index)=>{const prior=graphics.slice(0,index).at(-1);if(prior&&item.number-prior.number<=policy.nearbyGraphicDistance&&areDuplicateGraphicClaims(prior,item))warnings.push(`Scenes ${prior.number} and ${item.number} repeat substantially the same graphic claim.`);});
  if(policy.targets)Object.entries(CATEGORY_FAMILIES).forEach(([key,families])=>{const range=(policy.targets as any)[key];if(!range||!families)return;const actual=percent(plan.filter(item=>families.has(item.visual_family)).length,total);if(actual>Number(range.maximum)+policy.balanceTolerancePercent)warnings.push(`${key} is ${actual}% versus the advisory ${range.maximum}% maximum.`);});
  const duration=scenes.at(-1)?.end||0;if(duration>=30){for(let start=0;start<duration;start+=60){const numbers=new Set(scenes.filter(scene=>scene.start<start+60&&scene.end>start).map(scene=>scene.number)),window=plan.filter(item=>numbers.has(item.number));const required=Math.min(policy.minimumFamiliesPerMinute,window.length);if(window.length&&new Set(window.map(item=>item.visual_family)).size<required)warnings.push(`Scenes ${window[0].number}–${window.at(-1)?.number} contain fewer than ${required} meaningful visual families.`);}}
  return [...new Set(warnings)];
}

export function auditVisualBalance(topic:TopicBrief|null|undefined,scenes:TimedScene[],plan:PlannedScene[],changes:Pick<VisualBalanceDiagnostics,'graphicScenesReassigned'|'duplicateGraphicClaimsCollapsed'>={graphicScenesReassigned:0,duplicateGraphicClaimsCollapsed:0}):VisualBalanceDiagnostics{
  const counts=plan.reduce<Record<string,number>>((result,item)=>{result[item.visual_family]=(result[item.visual_family]||0)+1;return result;},{}),total=plan.length;
  const percentages=Object.fromEntries(Object.entries(counts).map(([family,count])=>[family,percent(count,total)]));
  const technical=counts.TECHNICAL_GRAPHIC||0,technicalRun=longestRun(plan,item=>item.visual_family,item=>item.visual_family==='TECHNICAL_GRAPHIC'),sameRun=longestRun(plan,item=>item.visual_family);
  return {totalScenes:total,visualFamilyCounts:counts,visualFamilyPercentages:percentages,technicalGraphicCount:technical,technicalGraphicPercentage:percent(technical,total),longestTechnicalGraphicRun:technicalRun.length,longestSameFamilyRun:sameRun,...changes,warnings:auditWarnings(topic,scenes,plan,policyFor(topic))};
}

function buildAlternative(topic:TopicBrief,scene:TimedScene,current:PlannedScene,candidate:BeatCandidate):PlannedScene{
  const beat=candidate.beat,stage=beat.applicable_stage_ids.includes(current.stage_id)?current.stage_id:(beat.applicable_stage_ids[0]||current.stage_id),environment=beat.environment_ids.includes(current.environment_ref)?current.environment_ref:(beat.environment_ids[0]||current.environment_ref);
  const next:PlannedScene={...current,chapter_id:candidate.chapterId,beat_id:beat.beat_id,visual_family:beat.visual_family,story_function:beat.story_function,visual_treatment:treatmentFor(beat),product_visibility:beat.product_visibility,stage_id:stage,environment_ref:environment,state:resolvePlannedState(topic,stage,beat.product_visibility),graphic_spec:null,reference_asset_ids:[...beat.reference_asset_ids],required_visible_features:[...beat.must_show],forbidden_elements:[...beat.must_not_show,...beat.negative_constraints],continuity_requirements:[...beat.continuity_requirements]};
  next.graphic_spec=deriveGraphicSceneSpec(topic,scene,next);return next;
}

function selectAlternative(topic:TopicBrief,scene:TimedScene,current:PlannedScene,base:PlannedScene|undefined,plan:PlannedScene[],index:number,beats:BeatCandidate[],accept:(item:PlannedScene)=>boolean,policy:Policy):PlannedScene|null{
  const options:Array<{plan:PlannedScene;score:number}>=[];
  if(base&&accept(base)&&!GRAPHIC_VISUAL_FAMILIES.has(base.visual_family))options.push({plan:{...base,semantic_group_id:current.semantic_group_id,semantic_group_beat_id:current.semantic_group_beat_id,semantic_group_intent:current.semantic_group_intent,alignment_confidence:current.alignment_confidence},score:100});
  const narration=tokens(`${scene.text} ${current.alignment_claim||''} ${current.semantic_group_intent||''}`),targetState=base?.state||current.state;
  beats.forEach(candidate=>{
    const beat=candidate.beat;if(GRAPHIC_VISUAL_FAMILIES.has(beat.visual_family))return;
    const candidateState=resolvePlannedState(topic,beat.applicable_stage_ids[0]||current.stage_id,beat.product_visibility);if(candidateState!==targetState)return;
    const semantic=overlap(narration,tokens(`${beat.beat_name} ${beat.narrative_purpose} ${(beat.semantic_alignment_terms||[]).join(' ')} ${(beat.must_show||[]).join(' ')}`));
    if(!semantic&&!(beat.story_function===current.story_function&&candidate.chapterId===current.chapter_id))return;
    const alternative=buildAlternative(topic,scene,current,candidate);if(!accept(alternative))return;
    let score=semantic*14+(beat.story_function===current.story_function?12:0)+(candidate.chapterId===current.chapter_id?10:0)+(alternative.stage_id===current.stage_id?4:0)+(alternative.environment_ref===current.environment_ref?3:0);
    const recent=new Set(plan.slice(Math.max(0,index-3),index).map(item=>item.visual_family));if(!recent.has(beat.visual_family))score+=7;
    const category=categoryFor(beat.visual_family),range=category&&policy.targets?(policy.targets as any)[category]:null;if(category&&range){const count=plan.filter(item=>CATEGORY_FAMILIES[category]?.has(item.visual_family)).length;if(percent(count,plan.length)<Number(range.minimum))score+=8;}
    options.push({plan:alternative,score});
  });
  return options.sort((a,b)=>b.score-a.score)[0]?.plan||null;
}

export function rebalanceVisualPlan(topic:TopicBrief,scenes:TimedScene[],input:PlannedScene[],basePlan:PlannedScene[]=[],options:VisualRebalanceOptions={}):VisualBalanceResult{
  const policy=policyFor(topic),beats=allowedBeats(topic),baseByNumber=new Map(basePlan.map(item=>[item.number,item])),lockedThroughScene=Math.max(0,Number(options.lockedThroughScene)||0);let plan=input.map(item=>({...item}));let graphicScenesReassigned=0,duplicateGraphicClaimsCollapsed=0;
  const replace=(index:number,accept:(item:PlannedScene)=>boolean,duplicate=false)=>{const current=plan[index];if(current.number<=lockedThroughScene)return false;const alternative=selectAlternative(topic,scenes[index],current,baseByNumber.get(current.number),plan,index,beats,accept,policy);if(!alternative)return false;plan[index]=alternative;if(GRAPHIC_VISUAL_FAMILIES.has(current.visual_family)){graphicScenesReassigned++;if(duplicate)duplicateGraphicClaimsCollapsed++;}return true;};

  for(let index=0;index<plan.length;index++)if(GRAPHIC_VISUAL_FAMILIES.has(plan[index].visual_family)){
    const priorIndex=plan.slice(0,index).map((item,offset)=>({item,offset})).filter(({item})=>GRAPHIC_VISUAL_FAMILIES.has(item.visual_family)).at(-1);
    if(priorIndex&&plan[index].number-priorIndex.item.number<=policy.nearbyGraphicDistance&&areDuplicateGraphicClaims(priorIndex.item,plan[index]))replace(index,item=>!GRAPHIC_VISUAL_FAMILIES.has(item.visual_family),true);
  }

  const referenceScenes=plan.filter(item=>item.visual_family==='ARCHIVAL_REFERENCE').length;
  const maximumGraphics=Math.max(0,Math.ceil(plan.length*policy.graphicsMaximumPercent/100)-referenceScenes);
  let excess=plan.filter(item=>GRAPHIC_VISUAL_FAMILIES.has(item.visual_family)).length-maximumGraphics;
  if(excess>0){const ranked=plan.map((item,index)=>({item,index,need:graphicNeedScore(scenes[index]?.text||'',item.alignment_claim||item.graphic_spec?.visual_claim||'')})).filter(({item})=>GRAPHIC_VISUAL_FAMILIES.has(item.visual_family)).sort((a,b)=>a.need-b.need||b.index-a.index);for(const candidate of ranked){if(excess<=0)break;if(replace(candidate.index,item=>!GRAPHIC_VISUAL_FAMILIES.has(item.visual_family)))excess--;}}

  for(let pass=0;pass<3;pass++){
    let changed=false,run=0,last:VisualFamily|undefined;
    for(let index=0;index<plan.length;index++){const family=plan[index].visual_family;run=family===last?run+1:1;last=family;if(run>policy.maximumConsecutiveSameFamily&&replace(index,item=>item.visual_family!==family)){changed=true;run=1;last=plan[index].visual_family;}}
    if(!changed)break;
  }
  for(let index=0,run=0,last='';index<plan.length;index++){const env=plan[index].environment_ref;run=env===last?run+1:1;last=env;if(run>policy.maximumConsecutiveEnvironment&&replace(index,item=>item.environment_ref!==env)){run=1;last=plan[index].environment_ref;}}
  for(let index=0,run=0;index<plan.length;index++){run=plan[index].product_visibility==='FULL'?run+1:0;if(run>policy.maximumConsecutiveFullProduct&&replace(index,item=>item.product_visibility!=='FULL'))run=plan[index].product_visibility==='FULL'?1:0;}

  const diagnostics=auditVisualBalance(topic,scenes,plan,{graphicScenesReassigned,duplicateGraphicClaimsCollapsed});
  return {plan,diagnostics};
}
