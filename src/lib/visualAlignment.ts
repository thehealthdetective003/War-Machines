import type { PlannedScene, TimedScene, TopicBrief, VisualFamily, VisualTreatment } from '../types';
import type { V2VisualBeat } from '../types/visualProductionV2';
import { deriveGraphicSceneSpec, resolvePlannedState } from './scenePlanner';
import { isManufacturingVisualClaim, isOperationalVisualClaim, lifecycleAlignmentIssues } from './directionSemantics';

export interface NarrativeVisualGroup {
  group_id:string;
  scene_numbers:number[];
  voiceover:string;
  previous_context:string;
  next_context:string;
}
export interface AlignmentCandidate {
  beat_id:string;
  beat_name:string;
  narrative_purpose:string;
  story_function:string;
  visual_family:string;
  semantic_alignment_terms:string[];
  stage_ids:string[];
  environment_ids:string[];
  product_visibility:string;
  must_show:string[];
  must_not_show:string[];
}
export interface AlignmentRequestGroup extends NarrativeVisualGroup { candidates:AlignmentCandidate[]; }
export interface VisualAlignmentSelection {
  group_id:string;
  source:'ENGINE_BEAT'|'VO_FALLBACK';
  beat_id:string|null;
  confidence:number;
  visual_claim:string;
}

const stop=new Set(['the','and','that','this','with','from','into','while','through','about','then','than','only','also','have','has','had','does','not','scene','show','visual','product','system']);
const tokens=(value:string)=>new Set((value.toLowerCase().match(/[a-z0-9]{3,}/g)||[]).filter(value=>!stop.has(value)));
const groundingTokens=(value:string)=>new Set([...tokens(value)].map(value=>value.length>5?value.slice(0,6):value));
const overlap=(a:Set<string>,b:Set<string>)=>[...a].filter(value=>b.has(value)).length;
const editorialNarration=(value:string)=>/\b(subscribe|follow (?:the|this|our)|watch next|next (?:episode|video|machine)|our channel|thanks? for watching|modus assembly)\b/i.test(value);
const OPERATIONAL_FAMILIES=new Set<VisualFamily>(['OPERATIONAL_CONTEXT','DYNAMIC_TESTING','ENVIRONMENTAL_TESTING','DELIVERY_AND_ROLLOUT','HERO_PRODUCT']);
const GRAPHIC_FAMILIES=new Set<VisualFamily>(['TECHNICAL_GRAPHIC','MAP_OR_SUPPLY_CHAIN']);
const treatment=(beat:V2VisualBeat):VisualTreatment=>{
  if(!['TECHNICAL_GRAPHIC','MAP_OR_SUPPLY_CHAIN'].includes(beat.visual_family))return 'LIVE_ACTION_T2V';
  const text=`${beat.beat_name} ${beat.narrative_purpose} ${beat.semantic_alignment_terms.join(' ')}`.toLowerCase();
  return /flow|path|sequence|motion|movement|relationship|layer|mechanism|supply|route/.test(text)?'MOTION_GRAPHIC_T2V':'STATIC_GRAPHIC_T2V';
};

export function buildNarrativeGroups(scenes:TimedScene[],maximum=4):NarrativeVisualGroup[]{
  const groups:NarrativeVisualGroup[]=[];let current:TimedScene[]=[];
  const flush=()=>{if(!current.length)return;const first=current[0],last=current.at(-1)!;groups.push({group_id:`VG_${String(groups.length+1).padStart(3,'0')}`,scene_numbers:current.map(scene=>scene.number),voiceover:current.map(scene=>scene.text).filter(Boolean).join(' ').replace(/\s+/g,' ').trim(),previous_context:scenes[first.number-2]?.text||'',next_context:scenes[last.number]?.text||''});current=[];};
  scenes.forEach(scene=>{current.push(scene);if(scene.silent||current.length>=maximum||/[.!?]["']?$/.test(scene.text.trim()))flush();});flush();return groups;
}

export function buildAlignmentRequests(topic:TopicBrief,scenes:TimedScene[],basePlan:PlannedScene[]):AlignmentRequestGroup[]{
  const handoff:any=topic._production_handoff;
  const chapters=handoff?.visual_story_plan?.chapters||[];
  const allowed=chapters.flatMap((chapter:any)=>(chapter.visual_beats||[]).map((beat:V2VisualBeat)=>({chapter_id:chapter.chapter_id,beat}))).filter((item:any)=>item.beat.generation_permission==='T2V_ALLOWED'&&item.beat.preferred_media_routes?.includes('GENERATED_T2V'));
  return buildNarrativeGroups(scenes).map(group=>{
    const chapterIds=new Set(group.scene_numbers.map(number=>basePlan[number-1]?.chapter_id).filter(Boolean));
    const groupTokens=tokens(`${group.voiceover} ${group.previous_context} ${group.next_context}`);
    const ranked=allowed.map((item:any)=>({item,score:overlap(groupTokens,tokens(`${item.beat.beat_name} ${item.beat.narrative_purpose} ${(item.beat.semantic_alignment_terms||[]).join(' ')}`))*10+(chapterIds.has(item.chapter_id)?3:0)})).sort((a:any,b:any)=>b.score-a.score||a.item.beat.beat_order-b.item.beat.beat_order).slice(0,8);
    return {...group,candidates:ranked.map(({item}:any)=>({beat_id:item.beat.beat_id,beat_name:item.beat.beat_name,narrative_purpose:item.beat.narrative_purpose,story_function:item.beat.story_function,visual_family:item.beat.visual_family,semantic_alignment_terms:item.beat.semantic_alignment_terms,stage_ids:item.beat.applicable_stage_ids,environment_ids:item.beat.environment_ids,product_visibility:item.beat.product_visibility,must_show:item.beat.must_show,must_not_show:[...item.beat.must_not_show,...item.beat.negative_constraints]}))};
  });
}

export function validateAlignmentSelections(requests:AlignmentRequestGroup[],raw:unknown):VisualAlignmentSelection[]{
  if(!Array.isArray(raw))throw new Error('Gemini returned a non-array visual alignment response.');
  const byId=new Map(requests.map(request=>[request.group_id,request]));const seen=new Set<string>();
  const selections=raw.map((item:any)=>{
    const group_id=String(item?.group_id||''),request=byId.get(group_id);if(!request)throw new Error(`Unexpected alignment group ${group_id||'(missing)'}.`);if(seen.has(group_id))throw new Error(`Duplicate alignment group ${group_id}.`);seen.add(group_id);
    const source=item?.source==='VO_FALLBACK'?'VO_FALLBACK':'ENGINE_BEAT';const beat_id=item?.beat_id===null?null:String(item?.beat_id||'');
    if(source==='ENGINE_BEAT'&&!request.candidates.some(candidate=>candidate.beat_id===beat_id))throw new Error(`${group_id} selected a beat outside its validated shortlist.`);
    if(source==='VO_FALLBACK'&&beat_id!==null)throw new Error(`${group_id} fallback must not claim an Engine beat.`);
    const confidence=Math.max(0,Math.min(1,Number(item?.confidence)||0));const visual_claim=String(item?.visual_claim||'').trim();if(!visual_claim)throw new Error(`${group_id} has no visual claim.`);
    const narrationTokens=groundingTokens(`${request.voiceover} ${request.previous_context} ${request.next_context}`),claimTokens=groundingTokens(visual_claim);if(!editorialNarration(request.voiceover)&&narrationTokens.size>=4&&claimTokens.size>=3&&overlap(narrationTokens,claimTokens)===0)throw new Error(`${group_id} visual claim is not grounded in its voiceover.`);
    if(source==='ENGINE_BEAT'){const candidate=request.candidates.find(value=>value.beat_id===beat_id)!;const lifecycle=lifecycleAlignmentIssues(visual_claim,candidate.visual_family);if(lifecycle.length)throw new Error(`${group_id} selected ${candidate.visual_family} for an incompatible narration lifecycle.`);}
    return {group_id,source,beat_id,confidence,visual_claim} as VisualAlignmentSelection;
  });
  const missing=requests.filter(request=>!seen.has(request.group_id));if(missing.length)throw new Error(`Gemini omitted visual alignment groups ${missing.map(item=>item.group_id).join(', ')}.`);return selections;
}

const fallbackFamily=(text:string):VisualFamily=>{
  if(isManufacturingVisualClaim(text))return 'ASSEMBLY_PROCESS';
  if(isOperationalVisualClaim(text))return 'OPERATIONAL_CONTEXT';
  if(/\b(name|called|means|official|compare|difference|why|timeline|map|route|distance|length|scale|satellite|concept|signal|coverage|communications?|relationship|flow|network)\b/i.test(text))return 'TECHNICAL_GRAPHIC';
  return 'ASSEMBLY_PROCESS';
};

const routeFallback=(handoff:any,request:AlignmentRequestGroup,selection:VisualAlignmentSelection,base:PlannedScene)=>{
  const desired=fallbackFamily(selection.visual_claim),claimTokens=tokens(`${request.voiceover} ${selection.visual_claim}`);
  const allowed:(V2VisualBeat[])=(handoff?.visual_story_plan?.chapters||[]).flatMap((chapter:any)=>chapter.visual_beats||[]).filter((beat:V2VisualBeat)=>beat.generation_permission==='T2V_ALLOWED'&&beat.preferred_media_routes?.includes('GENERATED_T2V'));
  const compatible=allowed.filter(beat=>desired==='OPERATIONAL_CONTEXT'?OPERATIONAL_FAMILIES.has(beat.visual_family):desired==='TECHNICAL_GRAPHIC'?GRAPHIC_FAMILIES.has(beat.visual_family):!OPERATIONAL_FAMILIES.has(beat.visual_family)&&!GRAPHIC_FAMILIES.has(beat.visual_family));
  const ranked=compatible.map(beat=>({beat,score:overlap(claimTokens,tokens(`${beat.beat_name} ${beat.narrative_purpose} ${(beat.semantic_alignment_terms||[]).join(' ')}`))})).sort((a,b)=>b.score-a.score||a.beat.beat_order-b.beat.beat_order);
  const beat=ranked[0]?.beat,operationalStage=desired==='OPERATIONAL_CONTEXT'?(handoff?.production_stages||[]).find((item:any)=>item.product_state_code==='C'):null;
  const stage=beat?.applicable_stage_ids[0]||operationalStage?.stage_id||base.stage_id,environment=beat?.environment_ids[0]||operationalStage?.environment_ids?.[0]||(desired==='OPERATIONAL_CONTEXT'?(handoff?.environments||[]).find((item:any)=>item.setting_scope==='OPERATIONAL')?.environment_id:null)||base.environment_ref;
  return {desired,beat,stage,environment};
};

export function applyVisualAlignments(topic:TopicBrief,scenes:TimedScene[],basePlan:PlannedScene[],requests:AlignmentRequestGroup[],selections:VisualAlignmentSelection[]):PlannedScene[]{
  const handoff:any=topic._production_handoff;const beats=new Map<string,V2VisualBeat>((handoff?.visual_story_plan?.chapters||[]).flatMap((chapter:any)=>chapter.visual_beats||[]).map((beat:V2VisualBeat)=>[beat.beat_id,beat]));
  const selectionByScene=new Map<number,{selection:VisualAlignmentSelection;request:AlignmentRequestGroup}>();requests.forEach(request=>{const selection=selections.find(item=>item.group_id===request.group_id)!;request.scene_numbers.forEach(number=>selectionByScene.set(number,{selection,request}));});
  return basePlan.map((base,index)=>{
    const matched=selectionByScene.get(base.number);if(!matched)return base;const {selection,request}=matched;
    if(selection.source==='VO_FALLBACK'){
      const route=routeFallback(handoff,request,selection,base),family=route.beat?.visual_family||route.desired,visual_treatment:VisualTreatment=route.beat?treatment(route.beat):family==='TECHNICAL_GRAPHIC'?'MOTION_GRAPHIC_T2V':'LIVE_ACTION_T2V',visibility=(route.beat?.product_visibility||(GRAPHIC_FAMILIES.has(family)?'NONE':OPERATIONAL_FAMILIES.has(family)?'FULL':'PARTIAL')) as PlannedScene['product_visibility'];
      const plan:PlannedScene={...base,beat_id:`${base.chapter_id}__VO_FALLBACK_${request.group_id}`,visual_family:family,story_function:route.beat?.story_function||(GRAPHIC_FAMILIES.has(family)?'EXPLAIN_HIDDEN_SYSTEM':OPERATIONAL_FAMILIES.has(family)?'DELIVER_PAYOFF':'EXPLAIN_PROCESS'),visual_treatment,product_visibility:visibility,stage_id:route.stage,environment_ref:route.environment,graphic_spec:null,reference_asset_ids:[],required_visible_features:GRAPHIC_FAMILIES.has(family)?['one text-free visual relationship',selection.visual_claim]:[selection.visual_claim],forbidden_elements:[...(route.beat?.must_not_show||[]),...(route.beat?.negative_constraints||[]),'unassigned exact facility or event claim','invented proprietary detail'],continuity_requirements:[...(route.beat?.continuity_requirements||[]),'preserve the routed lifecycle stage and environment'],alignment_source:'VO_FALLBACK',alignment_confidence:selection.confidence,alignment_claim:selection.visual_claim};
      plan.state=resolvePlannedState(topic,plan.stage_id,plan.product_visibility);plan.graphic_spec=deriveGraphicSceneSpec(topic,scenes[index],plan);if(plan.graphic_spec)plan.graphic_spec={...plan.graphic_spec,visual_claim:selection.visual_claim};return plan;
    }
    const beat=beats.get(selection.beat_id!);if(!beat)return base;const stage=beat.applicable_stage_ids[0]||base.stage_id,environment=beat.environment_ids[0]||base.environment_ref;
    const plan:PlannedScene={...base,beat_id:beat.beat_id,visual_family:beat.visual_family,story_function:beat.story_function,visual_treatment:treatment(beat),product_visibility:beat.product_visibility,stage_id:stage,environment_ref:environment,state:resolvePlannedState(topic,stage,beat.product_visibility),graphic_spec:null,reference_asset_ids:[...beat.reference_asset_ids],required_visible_features:[...beat.must_show],forbidden_elements:[...beat.must_not_show,...beat.negative_constraints],continuity_requirements:[...beat.continuity_requirements],alignment_source:'ENGINE_BEAT',alignment_confidence:selection.confidence,alignment_claim:selection.visual_claim};
    plan.graphic_spec=deriveGraphicSceneSpec(topic,scenes[index],plan);return plan;
  });
}
