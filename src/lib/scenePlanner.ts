import type { CameraPlatform, CinematicEnergy, PlannedScene, ProductVisibility, ShowdownRole, StoryFunction, TimedScene, TopicBrief, VisualFamily, VisualTreatment } from '../types';
import type { V2Chapter, V2VisualBeat, VisualProductionHandoffV2 } from '../types/visualProductionV2';
import { applyResolvedSceneContract, resolveSceneContract } from './sceneContract';
import { isLegacyGraphicBeat, isLegacyGraphicFamily, resolveCinematicAlternative } from './cinematicPolicy';

interface Candidate {
  chapter: V2Chapter | null;
  beat: V2VisualBeat;
  treatment: VisualTreatment;
  sourceBeatId: string;
  contractBeatId?: string;
}

const CONTEXT = new Set<VisualFamily>(['FACTORY_AERIAL','FACTORY_EXTERIOR','FACILITY_APPROACH','FACTORY_INTERIOR_WIDE']);
const OPERATIONAL = new Set<VisualFamily>(['OPERATIONAL_CONTEXT','DYNAMIC_TESTING','DELIVERY_AND_ROLLOUT']);
const STOP_WORDS=new Set(['the','and','that','this','with','from','into','while','through','about','then','than','only','also','must','still','each','when','where','which','their','there','have','has','had','does','not','without','show','scene','visual','product','aircraft','factory','system','stage','complete','completed','structure','production']);
const stem=(value:string)=>value.length>5?value.replace(/(?:ing|tion|ions|ments|ment|ed|es|s)$/,''):value;
const tokenize = (value: string) => new Set((value.toLowerCase().match(/[a-z0-9]{3,}/g) || []).map(stem).filter(value=>!STOP_WORDS.has(value)));
const overlap = (a: Set<string>, b: Set<string>) => [...a].filter(x => b.has(x)).length;
const isV2 = (topic: TopicBrief): topic is TopicBrief & { _production_handoff: VisualProductionHandoffV2 } =>
  (topic._production_handoff as any)?.schema?.version === '2.0.0';

export function resolvePlannedState(topic:TopicBrief|null|undefined,stageId:string,visibility:ProductVisibility):'A'|'B'|'C'{
  const rawStage=(topic as any)?._production_handoff?.production_stages?.find((item:any)=>item.stage_id===stageId);
  const legacyStage=topic?.lifecycle_stages?.find(item=>item.stage_id===stageId);
  const candidate=String(rawStage?.product_state_code||legacyStage?.state||'').toUpperCase().replace(/^STATE[_\s-]*/,'');
  if(candidate==='A'||candidate==='B'||candidate==='C')return candidate;
  return visibility==='FULL'?'C':visibility==='NONE'?'A':'B';
}

export function isOperationallyMobileProduct(topic:TopicBrief|null|undefined):boolean{
  const handoff:any=(topic as any)?._production_handoff;
  const identity=`${handoff?.product?.product_class||''} ${handoff?.product?.official_name||''} ${handoff?.product?.exact_variant||''} ${topic?.topic?.category||''} ${topic?.topic?.product||''}`.toLowerCase();
  const mobile=/\b(aircraft|airplane|aeroplane|helicopter|rotorcraft|fighter|jet|drone|uas|uav|warship|ship|submarine|tank|armou?red vehicle|military vehicle|automobile|truck|locomotive|train|spacecraft|rocket)\b/.test(identity);
  const hasOperationalBeat=handoff?.visual_story_plan?.chapters?.some((chapter:any)=>chapter.visual_beats?.some((beat:any)=>OPERATIONAL.has(beat.visual_family)));
  return mobile||Boolean(hasOperationalBeat);
}

export function isAviationProduct(topic:TopicBrief|null|undefined):boolean{
  const handoff:any=(topic as any)?._production_handoff;
  const identity=`${handoff?.product?.product_class||''} ${handoff?.product?.official_name||''} ${handoff?.product?.exact_variant||''} ${topic?.topic?.category||''} ${topic?.topic?.product||''}`.toLowerCase();
  return /\b(aircraft|airplane|aeroplane|helicopter|rotorcraft|fighter|jet|drone|uas|uav)\b/.test(identity);
}

const SHOWDOWN_PLATFORM:Record<ShowdownRole,CameraPlatform>={
  ANTICIPATION:'DISTANT_OBSERVATION',
  GROUND_REVEAL:'GROUND_TRIPOD',
  HUMAN_SCALE:'GROUND_HANDHELD',
  PREPARATION:'GROUND_HANDHELD',
  DEPARTURE:'RUNWAY_LONG_LENS',
  AIRBORNE_ESTABLISHMENT:'CHASE_AIRCRAFT',
  PERFORMANCE_PASS:'DISTANT_OBSERVATION',
  COCKPIT_IMMERSION:'COCKPIT_MOUNTED',
  ENVIRONMENTAL_SPECTACLE:'CHASE_AIRCRAFT',
  OPERATIONAL_RESET:'GROUND_HANDHELD',
  SECOND_PEAK:'CHASE_AIRCRAFT',
  CONTROLLED_RETURN:'RUNWAY_LONG_LENS',
};
const SHOWDOWN_ENERGY:Record<ShowdownRole,CinematicEnergy>={
  ANTICIPATION:'LOW',GROUND_REVEAL:'LOW',HUMAN_SCALE:'LOW',PREPARATION:'LOW',
  DEPARTURE:'MEDIUM',AIRBORNE_ESTABLISHMENT:'MEDIUM',PERFORMANCE_PASS:'HIGH',
  COCKPIT_IMMERSION:'HIGH',ENVIRONMENTAL_SPECTACLE:'HIGH',OPERATIONAL_RESET:'LOW',
  SECOND_PEAK:'HIGH',CONTROLLED_RETURN:'LOW',
};

function showdownRoleFor(scene:TimedScene,total:number,family:VisualFamily,operationalOrdinal:number):ShowdownRole|null{
  if(!OPERATIONAL.has(family))return null;
  const text=scene.text.toLowerCase(),progress=total<=1?0:(scene.number-1)/(total-1);
  if(/\b(landing approach|begins? to land|lands?|landed|after landing|touchdown|rollout|returns? to technicians?|taxi(?:ing)? back)\b/.test(text))return 'CONTROLLED_RETURN';
  if(/\b(cockpit|pilot|horizon|canopy|operator)\b/.test(text))return 'COCKPIT_IMMERSION';
  if(/\b(takeoff|takes off|lift(?:s|ed)? from the ground|rotation|rotates?|vertical climb)\b/.test(text))return 'DEPARTURE';
  if(/\b(begins? to roll|runway roll|taxi(?:ing)?|ground movement|steering|braking)\b/.test(text))return operationalOrdinal===1?'GROUND_REVEAL':'PREPARATION';
  if(/\b(vapor|condensation|cloud|heat haze|airflow|downwash|spray|dust)\b/.test(text))return 'ENVIRONMENTAL_SPECTACLE';
  if(/\b(inspect|inspection|ground check|power on|restrained|preparation)\b/.test(text))return 'OPERATIONAL_RESET';
  if(progress>=0.7&&operationalOrdinal>2)return 'SECOND_PEAK';
  if(/\b(accelerat|high.speed|low.altitude|steep|greater load|stronger)\b/.test(text))return 'PERFORMANCE_PASS';
  return operationalOrdinal<=2?'AIRBORNE_ESTABLISHMENT':'PERFORMANCE_PASS';
}

const treatmentFor=(_beat:V2VisualBeat):VisualTreatment=>'LIVE_ACTION_T2V';

function candidatesFromV2(topic:TopicBrief,handoff: VisualProductionHandoffV2): Candidate[] {
  const all = handoff.visual_story_plan.chapters.flatMap(chapter => chapter.visual_beats.map(beat => ({ chapter, beat })));
  // Reference discovery and visual inspection belong to the Engine. The app never
  // converts a restricted/reference/editor route into synthetic footage. Stage 4
  // is required to provide a separate generated-T2V alternative for that purpose.
  return all
    .filter(({beat})=>beat.generation_permission==='T2V_ALLOWED'&&beat.preferred_media_routes.includes('GENERATED_T2V')&&!isLegacyGraphicBeat(topic,beat))
    .map(({chapter,beat})=>({chapter,beat,treatment:treatmentFor(beat),sourceBeatId:beat.beat_id,contractBeatId:beat.beat_id}));
}

function legacyCandidates(topic: TopicBrief): Candidate[] {
  const families: VisualFamily[] = ['FACTORY_EXTERIOR','ASSEMBLY_PROCESS','COMPONENT_MACRO','MACHINERY_ACTION','QUALITY_CONTROL','TOOL_LEVEL_DETAIL','ATMOSPHERIC_INTERSTITIAL','OPERATIONAL_CONTEXT'];
  const stages = topic.lifecycle_stages || [];
  const usableStages=stages.length ? stages : [{ stage_id:'STAGE_01', stage_name:'Production', environment_ref: topic.environments[0]?.environment_id || 'ENV_01' } as any];
  const identity=`${topic.topic.category} ${topic.topic.product||''}`.toLowerCase();
  const operation=/helicopter|rotorcraft/.test(identity)?'completed aircraft performs one controlled hover, climb, transit, bank, or landing maneuver with visible rotor physics and environmental response':/aircraft|airplane|fighter|jet|uas|uav|drone/.test(identity)?'completed aircraft performs one controlled taxi, takeoff, climb, formation transit, banked pass, approach, or landing action with visible aerodynamic response':'completed product performs one supported defining operation in a generic non-identifying environment';
  const operationalEnv=topic.environments.find(environment=>/outdoor|test|operational|flight|apron|range|airfield|runway|deck/i.test(`${environment.name} ${environment.environment_type||''} ${environment.visual_details}`))?.environment_id||usableStages.at(-1)?.environment_ref||'ENV_OPERATIONAL';
  return usableStages.flatMap((stage, si) => families.filter(family=>!OPERATIONAL.has(family)||si===usableStages.length-1).map((family, fi) => ({
    chapter: null,
    sourceBeatId: `LEGACY_${si+1}_${fi+1}`,
    treatment:'LIVE_ACTION_T2V' as VisualTreatment,
    beat: { beat_id:`LEGACY_${si+1}_${fi+1}`, beat_order:fi+1, beat_name:family.replaceAll('_',' '), story_function:(OPERATIONAL.has(family)?'OPENING_HOOK':fi===0?'ESTABLISH_LOCATION':fi===5?'SHOW_PRECISION':fi===6?'RESET_ATTENTION':'EXPLAIN_PROCESS') as StoryFunction, visual_family:family, narrative_purpose:OPERATIONAL.has(family)?operation:stage.action || stage.stage_name, semantic_alignment_terms:[stage.stage_name,stage.action || '',family,OPERATIONAL.has(family)?operation:''], applicable_stage_ids:[stage.stage_id || `STAGE_${si+1}`], environment_ids:[OPERATIONAL.has(family)?operationalEnv:stage.environment_ref], product_visibility:family==='ATMOSPHERIC_INTERSTITIAL'?'NONE':family==='COMPONENT_MACRO'||family==='TOOL_LEVEL_DETAIL'?'DETAIL_ONLY':family==='ASSEMBLY_PROCESS'?'PARTIAL':'FULL', required_product_state_code:null, facility_claim_status:'CONTEXTUAL_INDUSTRIAL_VISUAL', reference_asset_ids:[], preferred_media_routes:['GENERATED_T2V'], generation_permission:'T2V_ALLOWED', exact_factory_claim_allowed:false, preferred_shot_scales:[], preferred_camera_movements:[], minimum_usable_duration_seconds:0, preferred_duration_seconds:10, maximum_duration_seconds:10, must_show:[], must_not_show:OPERATIONAL.has(family)?['weapon discharge','explosions or active combat','invented markings','exact event or location claim']:[], continuity_requirements:[], negative_constraints:[] } as V2VisualBeat,
  })));
}

function runLength<T>(items: T[], value: T): number { let count=0; for(let i=items.length-1;i>=0&&items[i]===value;i--) count++; return count; }

const CHAPTER_NUMBER_WORDS:Record<string,number>={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};
function explicitChapterIndex(text:string):number|null{
  const match=text.toLowerCase().match(/\bchapter\s+(?:(\d{1,2})|(one|two|three|four|five|six|seven|eight|nine|ten))\b/);
  if(!match)return null;
  const number=match[1]?Number(match[1]):CHAPTER_NUMBER_WORDS[match[2]];
  return Number.isInteger(number)&&number>0?number-1:null;
}
function chapterSearchText(chapter:V2Chapter):string{
  return [chapter.chapter_name,chapter.narrative_goal,chapter.chapter_question,chapter.chapter_payoff,chapter.opening_rehook_intent,...chapter.visual_beats.flatMap(beat=>[beat.beat_name,beat.narrative_purpose,...beat.semantic_alignment_terms])].filter(Boolean).join(' ');
}
export function alignScenesToChapters(handoff:VisualProductionHandoffV2|null,scenes:TimedScene[]):Array<V2Chapter|null>{
  const chapters=handoff?.visual_story_plan?.chapters||[];
  if(!chapters.length)return scenes.map(()=>null);
  const hasExplicit=scenes.some(scene=>explicitChapterIndex(scene.text)!==null);
  if(hasExplicit){let current=0;return scenes.map(scene=>{const explicit=explicitChapterIndex(scene.text);if(explicit!==null&&explicit>=current&&explicit<chapters.length)current=explicit;return chapters[current];});}
  if(scenes.length<chapters.length)return scenes.map((_,index)=>chapters[Math.min(chapters.length-1,Math.floor(index*chapters.length/Math.max(scenes.length,1)))]);
  const groups:Array<{scenes:TimedScene[];text:string}>=[];let pending:TimedScene[]=[];
  const flush=()=>{if(!pending.length)return;groups.push({scenes:pending,text:pending.map(scene=>scene.text).join(' ')});pending=[];};
  scenes.forEach(scene=>{pending.push(scene);if(scene.silent||pending.length>=4||/[.!?]["']?$/.test(scene.text.trim()))flush();});flush();
  if(groups.length<chapters.length)return scenes.map((_,index)=>chapters[Math.min(chapters.length-1,Math.floor(index*chapters.length/Math.max(scenes.length,1)))]);
  const chapterTokens=chapters.map(chapter=>tokenize(chapterSearchText(chapter))),negative=-1e9;
  const score=(groupIndex:number,chapterIndex:number)=>{
    const group=groups[groupIndex],context=[groups[groupIndex-1]?.text,group.text,groups[groupIndex+1]?.text].filter(Boolean).join(' ');
    const semantic=overlap(tokenize(context),chapterTokens[chapterIndex]);
    const expected=(groupIndex/Math.max(groups.length-1,1))*(chapters.length-1);
    return semantic*4-Math.abs(chapterIndex-expected)*0.7;
  };
  const dp=Array.from({length:groups.length},()=>Array(chapters.length).fill(negative)),previous=Array.from({length:groups.length},()=>Array(chapters.length).fill(-1));
  dp[0][0]=score(0,0);
  for(let groupIndex=1;groupIndex<groups.length;groupIndex++)for(let chapterIndex=0;chapterIndex<chapters.length;chapterIndex++){
    const stay=dp[groupIndex-1][chapterIndex],advance=chapterIndex>0?dp[groupIndex-1][chapterIndex-1]-0.4:negative;
    if(stay===negative&&advance===negative)continue;
    const fromAdvance=advance>stay;dp[groupIndex][chapterIndex]=(fromAdvance?advance:stay)+score(groupIndex,chapterIndex);previous[groupIndex][chapterIndex]=fromAdvance?chapterIndex-1:chapterIndex;
  }
  const assigned=Array(groups.length).fill(0);let chapterIndex=dp.at(-1)![chapters.length-1]===negative?dp.at(-1)!.reduce((best,value,index,row)=>value>row[best]?index:best,0):chapters.length-1;
  for(let groupIndex=groups.length-1;groupIndex>=0;groupIndex--){assigned[groupIndex]=chapterIndex;const prior=previous[groupIndex][chapterIndex];if(prior>=0)chapterIndex=prior;}
  const byScene=new Map<number,V2Chapter>();groups.forEach((group,index)=>group.scenes.forEach(scene=>byScene.set(scene.number,chapters[assigned[index]])));
  return scenes.map(scene=>byScene.get(scene.number)||chapters[0]);
}
const beatSemanticScore=(scene:TimedScene,beat:V2VisualBeat)=>overlap(tokenize(scene.text),tokenize(`${beat.beat_name} ${beat.narrative_purpose} ${beat.semantic_alignment_terms.join(' ')}`));
function facilityCueScore(text:string):number{
  const value=text.toLowerCase();
  return ((value.match(/\b(plant|facility|production site|manufacturing site|assembly space|production capacity|factory expansion|industrial complex|location)\b/g)||[]).length*5)
    +((value.match(/\b(factory scale|industrial scale|manufacturing place|assembly hall|factory building)\b/g)||[]).length*3);
}
function operationalCueScore(text:string):number{
  const value=text.toLowerCase();
  return (value.match(/\b(begins? to roll|accelerates?|lifts? from the ground|reaches? the runway|runway acceleration|taxi(?:s|es|ing)|takeoff|airborne|flight loads?|controlled flight|flyby|flies|flying|rotation tests?|controlled climb|controlled turn|bank(?:ing)? pass|maneuver(?:ing)?|landing approach|touchdown|rollout|hover(?:ing)?|ground movement)\b/g)||[]).length;
}
function atmosphericCueScore(text:string):number{
  return (text.toLowerCase().match(/\b(dawn|dusk|night|sunrise|sunset|rain|snow|fog|mist|cloud|weather|light shifts?|heat haze|steam|dust|sparks?|vibration|powered equipment ambience|industrial atmosphere)\b/g)||[]).length;
}
function isLifecycleRecap(text:string):boolean{
  return /\b(central question|whole manufacturing sequence|each stage|building the central structure|joining the airframe|installing propulsion|connecting electronics|closing the surface|chain of controlled decisions|factories,? systems and engineering|another aircraft to follow)\b/i.test(text);
}
function familyCueScore(text:string,family:VisualFamily):number{
  const value=text.toLowerCase(),count=(pattern:RegExp)=>(value.match(pattern)||[]).length;
  if(family==='ASSEMBLY_PROCESS')return count(/\b(assembly|assemble|install|join|connect|closure|closing|panel|structural section|interface|chain of controlled decisions)\b/g);
  if(family==='MACHINERY_ACTION')return count(/\b(position|lower|lift|crane|robotic|tooling|fixture|engine bay|controlled handling)\b/g);
  if(family==='MEASUREMENT_AND_CALIBRATION'||family==='QUALITY_CONTROL')return count(/\b(measure|calibrat|alignment check|reference point|symmetry check|inspect|verification|gauge)\b/g);
  if(family==='COMPONENT_LOGISTICS'||family==='MATERIAL_FLOW')return count(/\b(transport|move(?:d)? into|delivered component|logistics|forklift)\b/g);
  if(family==='WORKER_POV'||family==='TOOL_LEVEL_DETAIL'||family==='COMPONENT_MACRO')return count(/\b(technician|worker|inspect|diagnosis|corrective work|open access|connector|detail)\b/g);
  if(family==='FACTORY_INTERIOR_WIDE')return count(/\b(assembly hall|test hall|production line|assembly space|testing capacity|factory interior|factories,? systems and engineering)\b/g);
  if(family==='HERO_PRODUCT')return count(/\b(finished fighter|finished aircraft|externally complete|completed external form|delivery announcement|looks ready|recognisable|visible result)\b/g);
  if(family==='STATIC_GROUND_TEST')return count(/\b(ground check|power.on|engine start|restrained|static inspection|test isolates?|brakes and engine operation)\b/g);
  if(OPERATIONAL.has(family))return operationalCueScore(text);
  return 0;
}
function selectAerialScene(scenes:TimedScene[],chapterAssignments:Array<V2Chapter|null>,candidates:Candidate[]):number|null{
  let best:{number:number;score:number}|null=null;
  scenes.forEach((scene,index)=>{
    const chapter=chapterAssignments[index];
    const aerials=candidates.filter(candidate=>candidate.chapter?.chapter_id===chapter?.chapter_id&&candidate.beat.visual_family==='FACTORY_AERIAL');
    const facility=facilityCueScore(scene.text);
    if(!aerials.length||facility<4)return;
    const semantic=Math.max(...aerials.map(candidate=>beatSemanticScore(scene,candidate.beat)));
    const score=facility*10+semantic*4;
    if(!best||score>best.score)best={number:scene.number,score};
  });
  return best?.number||null;
}
function semanticFallbackCandidate(chapter:V2Chapter|null,candidates:Candidate[],topic:TopicBrief):Candidate{
  const seed=candidates.find(candidate=>candidate.chapter?.chapter_id===chapter?.chapter_id)||candidates[0];
  if(seed){
    const requestedStage=seed.beat.applicable_stage_ids[0]||chapter?.applicable_production_stage_ids[0]||topic.lifecycle_stages?.[0]?.stage_id||'STAGE_01';
    const seedContract=resolveSceneContract(topic,{number:0,chapter_id:chapter?.chapter_id||'',beat_id:seed.sourceBeatId,contract_beat_id:seed.contractBeatId,stage_id:requestedStage,environment_ref:'',visual_family:seed.beat.visual_family,story_function:seed.beat.story_function,visual_treatment:seed.treatment,product_visibility:seed.beat.product_visibility,state:resolvePlannedState(topic,requestedStage,seed.beat.product_visibility),reference_asset_ids:[],required_visible_features:[],forbidden_elements:[],continuity_requirements:[]});
    const stage=seedContract.stageId||requestedStage;
    const environment=seedContract.selectedEnvironmentId||topic.lifecycle_stages?.find(item=>item.stage_id===stage)?.environment_ref||topic.environments[0]?.environment_id||'ENV_01';
    const beat:V2VisualBeat={...seed.beat,beat_id:`${chapter?.chapter_id||'LEGACY'}__SEMANTIC_FALLBACK`,beat_name:'Narration-matched cinematic evidence',story_function:'EXPLAIN_PROCESS',visual_family:'COMPONENT_MACRO',narrative_purpose:'Show an externally visible, evidence-supported component, interface, inspection, or physical context while narration carries any abstract explanation.',semantic_alignment_terms:['physical','component','interface','inspection','documentary'],applicable_stage_ids:[stage],environment_ids:[environment],product_visibility:'DETAIL_ONLY',reference_asset_ids:[],preferred_media_routes:['GENERATED_T2V'],generation_permission:'T2V_ALLOWED',exact_factory_claim_allowed:false,must_show:[],must_not_show:[...seed.beat.must_not_show,'deployed product footage unrelated to the narration','unassigned factory aerial','technical graphics, diagrams, schematics, maps, vector overlays, floating arrows or labels','invented internal mechanisms']};
    return {chapter,beat,treatment:'LIVE_ACTION_T2V',sourceBeatId:beat.beat_id};
  }
  const handoff:any=topic._production_handoff,stage=chapter?.applicable_production_stage_ids?.[0]||handoff?.production_stages?.[0]?.stage_id||topic.lifecycle_stages?.[0]?.stage_id||'STAGE_01',environment=handoff?.production_stages?.find((item:any)=>item.stage_id===stage)?.environment_ids?.find((id:string)=>!id.toUpperCase().includes('GRAPHIC'))||handoff?.environments?.find((item:any)=>item.setting_scope!=='GRAPHIC_SPACE')?.environment_id||topic.environments?.[0]?.environment_id||'ENV_01';
  const beat={beat_id:`${chapter?.chapter_id||'LEGACY'}__CINEMATIC_FALLBACK`,beat_order:1,beat_name:'Evidence-safe cinematic fallback',story_function:'PROVIDE_CONTEXT',visual_family:'COMPONENT_MACRO',narrative_purpose:'Show a restrained photographic view of externally visible, documented physical detail without inventing internal behavior.',semantic_alignment_terms:['physical','external','documented','detail'],applicable_stage_ids:[stage],environment_ids:[environment],product_visibility:'DETAIL_ONLY',required_product_state_code:null,facility_claim_status:'GENERIC_NON_IDENTIFYING_VISUAL',reference_asset_ids:[],preferred_media_routes:['GENERATED_T2V'],generation_permission:'T2V_ALLOWED',exact_factory_claim_allowed:false,preferred_shot_scales:['CLOSE_UP'],preferred_camera_movements:['STATIC'],minimum_usable_duration_seconds:0,preferred_duration_seconds:6,maximum_duration_seconds:20,must_show:[],must_not_show:['technical graphics, diagrams, schematics, maps, vector overlays, floating arrows or labels','invented internal mechanisms'],continuity_requirements:[],negative_constraints:[]} as V2VisualBeat;
  return {chapter,beat,treatment:'LIVE_ACTION_T2V',sourceBeatId:beat.beat_id};
}

export function buildDocumentaryScenePlan(topic: TopicBrief, scenes: TimedScene[]): PlannedScene[] {
  const handoff = isV2(topic) ? topic._production_handoff : null;
  const operationalEligible=isOperationallyMobileProduct(topic);
  const aviationEligible=isAviationProduct(topic);
  const sourceCandidates = handoff ? candidatesFromV2(topic,handoff) : legacyCandidates(topic);
  if(handoff&&!sourceCandidates.length)throw new Error('The Engine handoff does not contain any visual beats authorized for generated cinematic T2V production.');
  const candidates=sourceCandidates.filter(candidate=>operationalEligible||!OPERATIONAL.has(candidate.beat.visual_family)||!candidate.sourceBeatId.startsWith('SYNTH_'));
  const rhythm=handoff?.visual_story_plan.rhythm_policy;
  const chapterAssignments=alignScenesToChapters(handoff,scenes);
  const aerialScene=selectAerialScene(scenes,chapterAssignments,candidates);
  const beatOrders=new Map(candidates.map(candidate=>[candidate.sourceBeatId,candidate.beat.beat_order]));
  const chapterSceneTotals=new Map<string,number>();
  chapterAssignments.forEach(chapter=>{const id=chapter?.chapter_id||'LEGACY_DOCUMENTARY';chapterSceneTotals.set(id,(chapterSceneTotals.get(id)||0)+1);});
  const chapterSceneSeen=new Map<string,number>();
  const plan: PlannedScene[] = [];
  let operationalCount=0;
  for (let i=0;i<scenes.length;i++) {
    const scene=scenes[i],vo=tokenize(scene.text),chapter=chapterAssignments[i],chapterId=chapter?.chapter_id||'LEGACY_DOCUMENTARY';
    const seen=(chapterSceneSeen.get(chapterId)||0)+1;chapterSceneSeen.set(chapterId,seen);
    const chapterProgress=(seen-1)/Math.max((chapterSceneTotals.get(chapterId)||1)-1,1);
    const inChapter=candidates.filter(candidate=>chapter?candidate.chapter?.chapter_id===chapter.chapter_id:true);
    const narrativePool=isLifecycleRecap(scene.text)?candidates.filter(candidate=>!CONTEXT.has(candidate.beat.visual_family)&&!OPERATIONAL.has(candidate.beat.visual_family)):inChapter;
    const operationalRelevant=operationalCueScore(scene.text)>0;
    const eligible=narrativePool.filter(candidate=>{
      const family=candidate.beat.visual_family;
      if(family==='FACTORY_AERIAL')return scene.number===aerialScene;
      if(isLegacyGraphicFamily(family))return false;
      if(OPERATIONAL.has(family))return operationalRelevant;
      if(family==='ATMOSPHERIC_INTERSTITIAL')return atmosphericCueScore(scene.text)>0;
      if(family==='CHAPTER_TRANSITION')return explicitChapterIndex(scene.text)!==null;
      return true;
    });
    const safePool=eligible.length?eligible:narrativePool.filter(candidate=>!CONTEXT.has(candidate.beat.visual_family)&&!isLegacyGraphicFamily(candidate.beat.visual_family)&&!OPERATIONAL.has(candidate.beat.visual_family));
    const pool=safePool.length?safePool:[semanticFallbackCandidate(chapter,candidates,topic)];
    const previous=plan.at(-1);
    const previousOrder=previous?beatOrders.get(previous.beat_id):undefined;
    const scored=pool.map(candidate => {
      const beat=candidate.beat;
      const words=tokenize(`${beat.beat_name} ${beat.narrative_purpose} ${beat.semantic_alignment_terms.join(' ')}`);
      const requestedStage=beat.applicable_stage_ids[0]||chapter?.applicable_production_stage_ids[0]||topic.lifecycle_stages?.[0]?.stage_id||'STAGE_01';
      const resolved=applyResolvedSceneContract(topic,{number:scene.number,chapter_id:chapterId,beat_id:candidate.sourceBeatId,contract_beat_id:candidate.contractBeatId,visual_family:beat.visual_family,story_function:beat.story_function,visual_treatment:candidate.treatment,product_visibility:beat.product_visibility,stage_id:requestedStage,environment_ref:'',state:resolvePlannedState(topic,requestedStage,beat.product_visibility),showdown_role:null,energy_level:'MEDIUM',camera_platform:null,graphic_spec:null,reference_asset_ids:[],required_visible_features:[],forbidden_elements:[],continuity_requirements:[],alignment_source:'ENGINE_BEAT',alignment_claim:beat.narrative_purpose});
      const stage=resolved.stage_id,env=resolved.environment_ref;
      const semantic=overlap(vo,words);
      const orderRange=Math.max(...pool.map(item=>item.beat.beat_order),1);
      let score=semantic*14-Math.abs((beat.beat_order/orderRange)-chapterProgress)*5;
      score+=familyCueScore(scene.text,beat.visual_family)*9;
      if(scene.duration<beat.minimum_usable_duration_seconds)score-=30;
      else if(scene.duration>beat.maximum_duration_seconds)score-=Math.min(12,(scene.duration-beat.maximum_duration_seconds)*3);
      if(scene.number===aerialScene&&beat.visual_family==='FACTORY_AERIAL')score+=500;
      if(operationalRelevant&&OPERATIONAL.has(beat.visual_family))score+=35;
      if(previous?.chapter_id===chapterId){
        if(previous.beat_id===candidate.sourceBeatId)score+=runLength(plan.map(item=>item.beat_id),candidate.sourceBeatId)<4?22:-12;
        else if(previous.visual_family===beat.visual_family)score+=12;
        if(previous.environment_ref===env)score+=5;
        if(previousOrder!==undefined&&beat.beat_order<previousOrder)score-=28;
      }
      const familyRun=runLength(plan.map(item=>item.visual_family),beat.visual_family);
      const environmentRun=runLength(plan.map(item=>item.environment_ref),env);
      const fullRun=beat.product_visibility==='FULL'?runLength(plan.map(item=>item.product_visibility),'FULL'):0;
      if(familyRun>=Math.max(1,rhythm?.maximum_consecutive_same_visual_family??5))score-=90;
      if(environmentRun>=Math.max(1,rhythm?.maximum_consecutive_same_environment_without_new_information??6))score-=55;
      if(beat.product_visibility==='FULL'&&fullRun>=Math.max(1,rhythm?.maximum_consecutive_full_product_scenes??4))score-=70;
      return {candidate,stage,env,score,resolved};
    }).sort((a,b)=>b.score-a.score||a.candidate.beat.beat_order-b.candidate.beat.beat_order);
    const chosen=scored[0];
    const beat=chosen.candidate.beat;
    const isOperational=OPERATIONAL.has(beat.visual_family);
    if(isOperational)operationalCount++;
    const showdownRole=aviationEligible?showdownRoleFor(scene,scenes.length,beat.visual_family,operationalCount):null;
    const plannedVisibility:ProductVisibility=showdownRole==='COCKPIT_IMMERSION'?'DETAIL_ONLY':beat.product_visibility;
    let planItem:PlannedScene={
      ...chosen.resolved,
      number:scene.number, chapter_id:chapterId,
      beat_id:chosen.candidate.sourceBeatId, contract_beat_id:chosen.candidate.contractBeatId,
      visual_treatment:chosen.candidate.treatment,
      product_visibility:plannedVisibility,
      showdown_role:showdownRole,
      energy_level:showdownRole?SHOWDOWN_ENERGY[showdownRole]:'MEDIUM',
      camera_platform:showdownRole?SHOWDOWN_PLATFORM[showdownRole]:null,
      graphic_spec:null,
      alignment_source:'ENGINE_BEAT',
      alignment_claim:beat.narrative_purpose,
    };
    planItem=applyResolvedSceneContract(topic,planItem,chosen.candidate.contractBeatId);
    planItem=resolveCinematicAlternative(topic,scene,planItem);
    plan.push(planItem);
  }
  return plan;
}

export function summarizeScenePlan(plan: PlannedScene[]) {
  const count=(key:keyof PlannedScene)=>Object.entries(plan.reduce<Record<string,number>>((a,x)=>{const v=String(x[key]);a[v]=(a[v]||0)+1;return a;},{})).sort((a,b)=>b[1]-a[1]);
  const operational=plan.filter(item=>OPERATIONAL.has(item.visual_family));
  const showdown=plan.filter(item=>item.showdown_role);
  return { families:count('visual_family'), treatments:count('visual_treatment'), visibility:count('product_visibility'), showdownRoles:count('showdown_role'), operationalScenes:operational.length, openingOperationalScenes:operational.filter(item=>item.number<=10).length, firstOperationalScene:operational[0]?.number, showdownScenes:showdown.length };
}
