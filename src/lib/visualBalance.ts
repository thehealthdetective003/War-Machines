import type { PlannedScene, TimedScene, TopicBrief, VisualFamily } from '../types';
import type { V2VisualBalanceTargets, V2VisualBeat, V2VisualStoryPlan } from '../types/visualProductionV2';
import { applyResolvedSceneContract } from './sceneContract';
import { cinematicGenerationBeats, hasActiveGraphicConfiguration, resolveCinematicAlternative } from './cinematicPolicy';

const DEFAULT_POLICY={maximumConsecutiveSameFamily:2,maximumConsecutiveEnvironment:3,maximumConsecutiveFullProduct:2,minimumFamiliesPerMinute:3,balanceTolerancePercent:3};
const STOP=new Set(['the','and','that','this','with','from','into','while','through','about','then','than','only','also','have','has','had','does','not','scene','show','visual','product','system']);
const stem=(value:string)=>value.length>5?value.replace(/(?:ing|tion|ions|ments|ment|ed|es|s)$/,''):value;
const tokens=(value:string)=>new Set((value.toLowerCase().match(/[a-z0-9]{3,}/g)||[]).map(stem).filter(value=>!STOP.has(value)));
const overlap=(a:Set<string>,b:Set<string>)=>[...a].filter(value=>b.has(value)).length;
const percent=(count:number,total:number)=>total?Number((count*100/total).toFixed(2)):0;
type BalanceCategory=keyof V2VisualBalanceTargets;
const CATEGORY_FAMILIES:Partial<Record<BalanceCategory,Set<VisualFamily>>>={
  manufacturing_and_assembly_percent:new Set(['ASSEMBLY_PROCESS','MACHINERY_ACTION','WORKER_POV','MATERIAL_FLOW']),
  factory_scale_and_logistics_percent:new Set(['FACTORY_AERIAL','FACTORY_EXTERIOR','FACILITY_APPROACH','FACTORY_INTERIOR_WIDE','COMPONENT_LOGISTICS']),
  component_detail_and_quality_control_percent:new Set(['COMPONENT_MACRO','TOOL_LEVEL_DETAIL','QUALITY_CONTROL','MEASUREMENT_AND_CALIBRATION']),
  testing_and_operational_context_percent:new Set(['ENVIRONMENTAL_TESTING','STATIC_GROUND_TEST','DYNAMIC_TESTING','DELIVERY_AND_ROLLOUT','OPERATIONAL_CONTEXT']),
  // Closed V2 name retained; active allocation is reference/archive only. Graphics share is always zero.
  graphics_and_reference_media_percent:new Set(['ARCHIVAL_REFERENCE']),
  completed_product_hero_imagery_percent:new Set(['HERO_PRODUCT']),
};
const PROCESS_FAMILIES=new Set<VisualFamily>(['ASSEMBLY_PROCESS','MACHINERY_ACTION','WORKER_POV','MATERIAL_FLOW','COMPONENT_LOGISTICS','TOOL_LEVEL_DETAIL']);
const TESTING_FAMILIES=new Set<VisualFamily>(['QUALITY_CONTROL','MEASUREMENT_AND_CALIBRATION','ENVIRONMENTAL_TESTING','STATIC_GROUND_TEST','DYNAMIC_TESTING']);

export interface LongestVisualRun {family:string;length:number;startScene:number|null;endScene:number|null;}
export interface VisualBalanceDiagnostics {totalScenes:number;visualFamilyCounts:Record<string,number>;visualFamilyPercentages:Record<string,number>;referenceMediaCount:number;referenceMediaPercentage:number;processCoveragePercentage:number;testingCoveragePercentage:number;longestSameFamilyRun:LongestVisualRun;cinematicScenesNormalized:number;warnings:string[];}
export interface VisualBalanceResult {plan:PlannedScene[];diagnostics:VisualBalanceDiagnostics;}
export interface VisualRebalanceOptions {lockedThroughScene?:number;}
interface Policy {maximumConsecutiveSameFamily:number;maximumConsecutiveEnvironment:number;maximumConsecutiveFullProduct:number;minimumFamiliesPerMinute:number;balanceTolerancePercent:number;targets?:V2VisualBalanceTargets;}

const storyFor=(topic:TopicBrief|null|undefined)=>(topic as any)?._production_handoff?.visual_story_plan as V2VisualStoryPlan|undefined;
const policyFor=(topic:TopicBrief|null|undefined):Policy=>{const story=storyFor(topic),rhythm=story?.rhythm_policy;return {maximumConsecutiveSameFamily:Math.max(1,Number(rhythm?.maximum_consecutive_same_visual_family)||DEFAULT_POLICY.maximumConsecutiveSameFamily),maximumConsecutiveEnvironment:Math.max(1,Number(rhythm?.maximum_consecutive_same_environment_without_new_information)||DEFAULT_POLICY.maximumConsecutiveEnvironment),maximumConsecutiveFullProduct:Math.max(1,Number(rhythm?.maximum_consecutive_full_product_scenes)||DEFAULT_POLICY.maximumConsecutiveFullProduct),minimumFamiliesPerMinute:Math.max(1,Number(rhythm?.minimum_meaningful_visual_families_per_60_seconds)||DEFAULT_POLICY.minimumFamiliesPerMinute),balanceTolerancePercent:DEFAULT_POLICY.balanceTolerancePercent,targets:story?.visual_balance_targets};};
function longestRun<T>(plan:PlannedScene[],value:(item:PlannedScene)=>T,accept?:(item:PlannedScene)=>boolean):LongestVisualRun{let best:LongestVisualRun={family:'',length:0,startScene:null,endScene:null},run=0,last:T|undefined,start=0;plan.forEach((item,index)=>{const current=value(item),included=accept?accept(item):true;if(included&&run&&current===last)run++;else{run=included?1:0;start=index;}last=included?current:undefined;if(run>best.length)best={family:String(current),length:run,startScene:plan[start]?.number??null,endScene:item.number};});return best;}

function auditWarnings(topic:TopicBrief|null|undefined,scenes:TimedScene[],plan:PlannedScene[],policy:Policy):string[]{
  const warnings:string[]=[],total=plan.length,familyRun=longestRun(plan,item=>item.visual_family);
  if(familyRun.length>policy.maximumConsecutiveSameFamily)warnings.push(`${familyRun.family} runs for ${familyRun.length} scenes; configured maximum is ${policy.maximumConsecutiveSameFamily}.`);
  const envRun=longestRun(plan,item=>item.environment_ref);if(envRun.length>policy.maximumConsecutiveEnvironment)warnings.push(`${envRun.family} repeats for ${envRun.length} scenes; configured environment maximum is ${policy.maximumConsecutiveEnvironment}.`);
  const fullRun=longestRun(plan,item=>item.product_visibility,item=>item.product_visibility==='FULL');if(fullRun.length>policy.maximumConsecutiveFullProduct)warnings.push(`FULL product visibility repeats for ${fullRun.length} scenes; configured maximum is ${policy.maximumConsecutiveFullProduct}.`);
  if(policy.targets)Object.entries(CATEGORY_FAMILIES).forEach(([key,families])=>{const range=(policy.targets as any)[key];if(!range||!families)return;const actual=percent(plan.filter(item=>families.has(item.visual_family)).length,total);if(actual>Number(range.maximum)+policy.balanceTolerancePercent)warnings.push(`${key==='graphics_and_reference_media_percent'?'reference_and_archival_media_percent':key} is ${actual}% versus the advisory ${range.maximum}% maximum.`);});
  const duration=scenes.at(-1)?.end||0;if(duration>=30)for(let start=0;start<duration;start+=60){const numbers=new Set(scenes.filter(scene=>scene.start<start+60&&scene.end>start).map(scene=>scene.number)),window=plan.filter(item=>numbers.has(item.number)),required=Math.min(policy.minimumFamiliesPerMinute,window.length);if(window.length&&new Set(window.map(item=>item.visual_family)).size<required)warnings.push(`Scenes ${window[0].number}–${window.at(-1)?.number} contain fewer than ${required} meaningful cinematic visual families.`);}
  return [...new Set(warnings)];
}

export function auditVisualBalance(topic:TopicBrief|null|undefined,scenes:TimedScene[],plan:PlannedScene[],cinematicScenesNormalized=0):VisualBalanceDiagnostics{
  const counts=plan.reduce<Record<string,number>>((result,item)=>{result[item.visual_family]=(result[item.visual_family]||0)+1;return result;},{}),total=plan.length,reference=counts.ARCHIVAL_REFERENCE||0;
  return {totalScenes:total,visualFamilyCounts:counts,visualFamilyPercentages:Object.fromEntries(Object.entries(counts).map(([family,count])=>[family,percent(count,total)])),referenceMediaCount:reference,referenceMediaPercentage:percent(reference,total),processCoveragePercentage:percent(plan.filter(item=>PROCESS_FAMILIES.has(item.visual_family)).length,total),testingCoveragePercentage:percent(plan.filter(item=>TESTING_FAMILIES.has(item.visual_family)).length,total),longestSameFamilyRun:longestRun(plan,item=>item.visual_family),cinematicScenesNormalized,warnings:auditWarnings(topic,scenes,plan,policyFor(topic))};
}

function buildAlternative(topic:TopicBrief,scene:TimedScene,current:PlannedScene,chapterId:string,beat:V2VisualBeat):PlannedScene{
  const stage=beat.applicable_stage_ids.includes(current.stage_id)?current.stage_id:(beat.applicable_stage_ids[0]||current.stage_id);
  let next:PlannedScene={...current,chapter_id:chapterId,beat_id:beat.beat_id,contract_beat_id:beat.beat_id,visual_family:beat.visual_family,story_function:beat.story_function,visual_treatment:'LIVE_ACTION_T2V',product_visibility:beat.product_visibility,stage_id:stage,environment_ref:'',graphic_spec:null,reference_asset_ids:[...beat.reference_asset_ids],required_visible_features:[...beat.must_show],forbidden_elements:[...beat.must_not_show,...beat.negative_constraints],continuity_requirements:[...beat.continuity_requirements],alignment_claim:beat.narrative_purpose};
  next=applyResolvedSceneContract(topic,next,beat.beat_id);return resolveCinematicAlternative(topic,scene,next);
}

function alternativeFor(topic:TopicBrief,scene:TimedScene,current:PlannedScene,plan:PlannedScene[],index:number,accept:(item:PlannedScene)=>boolean):PlannedScene|null{
  const narration=tokens(`${scene.text} ${current.alignment_claim||''}`),recent=new Set(plan.slice(Math.max(0,index-3),index).map(item=>item.visual_family));
  return cinematicGenerationBeats(topic).map(candidate=>{const alternative=buildAlternative(topic,scene,current,candidate.chapterId,candidate.beat);if(!accept(alternative))return null;let score=overlap(narration,tokens(`${candidate.beat.beat_name} ${candidate.beat.narrative_purpose} ${(candidate.beat.semantic_alignment_terms||[]).join(' ')}`))*14+(candidate.chapterId===current.chapter_id?8:0)+(alternative.stage_id===current.stage_id?5:0);if(!recent.has(alternative.visual_family))score+=8;return {alternative,score};}).filter((item):item is {alternative:PlannedScene;score:number}=>Boolean(item)).sort((a,b)=>b.score-a.score)[0]?.alternative||null;
}

export function rebalanceVisualPlan(topic:TopicBrief,scenes:TimedScene[],input:PlannedScene[],_basePlan:PlannedScene[]=[],options:VisualRebalanceOptions={}):VisualBalanceResult{
  const policy=policyFor(topic),lockedThroughScene=Math.max(0,Number(options.lockedThroughScene)||0);let cinematicScenesNormalized=0;
  let plan=input.map((item,index)=>{if(!hasActiveGraphicConfiguration(topic,item))return {...item,visual_treatment:'LIVE_ACTION_T2V' as const,graphic_spec:null};cinematicScenesNormalized++;return resolveCinematicAlternative(topic,scenes[index],item);});
  const replace=(index:number,accept:(item:PlannedScene)=>boolean)=>{if(plan[index].number<=lockedThroughScene)return false;const alternative=alternativeFor(topic,scenes[index],plan[index],plan,index,accept);if(!alternative)return false;plan[index]=alternative;return true;};
  for(let pass=0;pass<3;pass++){let changed=false,run=0,last:VisualFamily|undefined;for(let index=0;index<plan.length;index++){const family=plan[index].visual_family;run=family===last?run+1:1;last=family;if(run>policy.maximumConsecutiveSameFamily&&replace(index,item=>item.visual_family!==family)){changed=true;run=1;last=plan[index].visual_family;}}if(!changed)break;}
  for(let index=0,run=0,last='';index<plan.length;index++){const env=plan[index].environment_ref;run=env===last?run+1:1;last=env;if(run>policy.maximumConsecutiveEnvironment&&replace(index,item=>item.environment_ref!==env)){run=1;last=plan[index].environment_ref;}}
  for(let index=0,run=0;index<plan.length;index++){run=plan[index].product_visibility==='FULL'?run+1:0;if(run>policy.maximumConsecutiveFullProduct&&replace(index,item=>item.product_visibility!=='FULL'))run=plan[index].product_visibility==='FULL'?1:0;}
  return {plan,diagnostics:auditVisualBalance(topic,scenes,plan,cinematicScenesNormalized)};
}
