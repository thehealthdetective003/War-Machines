import type { AppState, GenerationSession, PlannedScene, ProductionBatchState, ProductionContext, ProductionOperation, SceneDirection, T2VPrompt, TimedScene } from '../types';

export const PRODUCTION_BATCH_TARGET=8;
export const PRODUCTION_BATCH_MIN=6;
export const PRODUCTION_BATCH_MAX=10;

const uniqueSorted=(values:number[])=>[...new Set(values.filter(Number.isInteger))].sort((a,b)=>a-b);
const emptyContext=():ProductionContext=>({lifecycleState:null,recentVisualFamilies:[],previousEnvironment:null,previousCameraTreatment:null,recentGraphicSceneNumbers:[],recentBeatIds:[],previousVisualClaim:null,productConfiguration:null,continuityRequirements:[],unresolvedBridge:null,visualFamilyCounts:{},completedSceneNumbers:[]});
export const emptyProductionContext=emptyContext;

const boundaryScore=(scenes:TimedScene[],plan:PlannedScene[],endIndex:number,targetStart:number)=>{
  const current=scenes[endIndex],next=scenes[endIndex+1],currentPlan=plan.find(item=>item.number===current?.number),nextPlan=plan.find(item=>item.number===next?.number);let score=-Math.abs((endIndex-targetStart+1)-PRODUCTION_BATCH_TARGET)*2;
  if(current?.silent||next?.silent)score+=7;
  if(/[.!?]["']?$/.test(current?.text.trim()||''))score+=4;
  if(currentPlan&&nextPlan&&currentPlan.chapter_id!==nextPlan.chapter_id)score+=10;
  if(currentPlan&&nextPlan&&currentPlan.stage_id!==nextPlan.stage_id)score+=8;
  if(currentPlan&&['CONCLUDE_CHAPTER','DELIVER_PAYOFF','RESET_ATTENTION'].includes(currentPlan.story_function))score+=6;
  return score;
};

export function createProductionBatches(scenes:TimedScene[],plan:PlannedScene[]=[]):ProductionBatchState[]{
  const batches:ProductionBatchState[]=[];let start=0;
  while(start<scenes.length){const remaining=scenes.length-start;if(remaining<=PRODUCTION_BATCH_MAX){batches.push(makeBatch(batches.length,scenes.slice(start)));break;}
    const candidates:number[]=[];for(let size=PRODUCTION_BATCH_MIN;size<=Math.min(PRODUCTION_BATCH_MAX,remaining-1);size++)candidates.push(start+size-1);
    const score=(end:number)=>boundaryScore(scenes,plan,end,start)-Math.max(0,PRODUCTION_BATCH_MIN-(remaining-(end-start+1)))*4;
    const end=(candidates.length?candidates:[Math.min(scenes.length-1,start+PRODUCTION_BATCH_TARGET-1)]).sort((a,b)=>score(b)-score(a)||Math.abs((a-start+1)-PRODUCTION_BATCH_TARGET)-Math.abs((b-start+1)-PRODUCTION_BATCH_TARGET))[0];
    batches.push(makeBatch(batches.length,scenes.slice(start,end+1)));start=end+1;
  }
  return batches;
}
const makeBatch=(index:number,scenes:TimedScene[]):ProductionBatchState=>({id:`BATCH_${String(index+1).padStart(3,'0')}`,index:index+1,sceneNumbers:scenes.map(scene=>scene.number),operation:'QUEUED',directionCompletedSceneNumbers:[],promptCompletedSceneNumbers:[],qaCompletedSceneNumbers:[],directionCorrectionCandidates:[],promptCorrectionSceneNumbers:[],directionCorrectionSceneNumbers:[],correctionIssues:{},alignmentSelections:[],contextSnapshot:null,correctionReason:null,lastCommittedAt:null,error:null});

export function createProductionSession(scenes:TimedScene[],plan:PlannedScene[]=[]):GenerationSession{
  const batches=createProductionBatches(scenes,plan);return {status:'paused',totalBatches:batches.length,currentBatch:0,batchStartScene:null,batchEndScene:null,completedScenes:0,startedAt:null,lastCommittedAt:null,error:null,operation:'QUEUED',activeBatchId:batches[0]?.id||null,batches,completedSceneNumbers:[],pendingSceneNumbers:scenes.map(scene=>scene.number),directionCompletedSceneNumbers:[],promptCompletedSceneNumbers:[],qaCompletedSceneNumbers:[],correctionPendingSceneNumbers:[],pauseReason:null,context:emptyContext()};
}

export function createResumableProductionSession(scenes:TimedScene[],plan:PlannedScene[],directions:SceneDirection[],prompts:T2VPrompt[]):GenerationSession{
  let session=createProductionSession(scenes,plan),planNumbers=new Set(plan.map(item=>item.number)),directionNumbers=new Set(directions.map(item=>item.number)),promptNumbers=new Set(prompts.map(item=>item.number));
  session.batches=session.batches.map(batch=>{const planned=batch.sceneNumbers.every(number=>planNumbers.has(number)),directed=batch.sceneNumbers.every(number=>directionNumbers.has(number)),prompted=batch.sceneNumbers.every(number=>promptNumbers.has(number));return {...batch,operation:prompted?'COMPLETE':directed?'DIRECTED':planned?'ALIGNED':'QUEUED',directionCompletedSceneNumbers:batch.sceneNumbers.filter(number=>directionNumbers.has(number)),promptCompletedSceneNumbers:batch.sceneNumbers.filter(number=>promptNumbers.has(number)),qaCompletedSceneNumbers:batch.sceneNumbers.filter(number=>promptNumbers.has(number))};});
  session={...session,status:prompts.length===scenes.length&&scenes.length>0?'complete':'paused',operation:session.batches.find(batch=>batch.operation!=='COMPLETE')?.operation||'COMPLETE'};
  return synchronizeProductionSession(session,{topic:null,plannedScenes:plan,sceneDirections:directions,visualPrompts:prompts,voiceoverTranscription:{scenes} as any});
}

export function deriveProductionContext(state:Pick<AppState,'topic'|'plannedScenes'|'sceneDirections'|'visualPrompts'>):ProductionContext{
  const prompts=new Set(state.visualPrompts.map(item=>item.number)),completed=state.sceneDirections.filter(item=>prompts.has(item.number)).sort((a,b)=>a.number-b.number),recent=completed.slice(-6),planByNumber=new Map(state.plannedScenes.map(item=>[item.number,item])),last=completed.at(-1),lastPlan=last?planByNumber.get(last.number):undefined;
  const visualFamilyCounts=completed.reduce<Record<string,number>>((result,item)=>{const key=String(item.visual_family||'UNKNOWN');result[key]=(result[key]||0)+1;return result;},{});
  const configuration=String((state.topic as any)?._production_handoff?.product?.exact_variant||state.topic?.topic?.product||'').trim()||null;
  return {lifecycleState:last?.state||null,recentVisualFamilies:recent.map(item=>item.visual_family).filter(Boolean) as any,previousEnvironment:last?.environment_ref||null,previousCameraTreatment:last?`${last.camera?.shot_scale||''} · ${last.camera?.movement||''}`:null,recentGraphicSceneNumbers:recent.filter(item=>item.visual_family==='TECHNICAL_GRAPHIC'||item.visual_family==='MAP_OR_SUPPLY_CHAIN').map(item=>item.number),recentBeatIds:recent.map(item=>item.beat_id).filter(Boolean) as string[],previousVisualClaim:last?.alignment_claim||null,productConfiguration:configuration,continuityRequirements:lastPlan?.continuity_requirements||[],unresolvedBridge:last?.transition_to_next||null,visualFamilyCounts,completedSceneNumbers:completed.map(item=>item.number)};
}

export function synchronizeProductionSession(session:GenerationSession,state:Pick<AppState,'topic'|'plannedScenes'|'sceneDirections'|'visualPrompts'|'voiceoverTranscription'>):GenerationSession{
  const all=state.voiceoverTranscription?.scenes.map(item=>item.number)||[],directions=uniqueSorted(state.sceneDirections.map(item=>item.number)),prompts=uniqueSorted(state.visualPrompts.map(item=>item.number)),completed=all.filter(number=>prompts.includes(number));
  const batches=session.batches.map(batch=>({...batch,directionCompletedSceneNumbers:batch.sceneNumbers.filter(number=>directions.includes(number)),promptCompletedSceneNumbers:batch.sceneNumbers.filter(number=>prompts.includes(number)),qaCompletedSceneNumbers:batch.sceneNumbers.filter(number=>prompts.includes(number)&&!batch.promptCorrectionSceneNumbers.includes(number))}));
  const pending=all.filter(number=>!completed.includes(number)),active=batches.find(batch=>batch.operation!=='COMPLETE')||null;
  return {...session,batches,totalBatches:batches.length,currentBatch:active?.index||batches.length,activeBatchId:active?.id||null,batchStartScene:active?.sceneNumbers[0]??null,batchEndScene:active?.sceneNumbers.at(-1)??null,completedScenes:completed.length,completedSceneNumbers:completed,pendingSceneNumbers:pending,directionCompletedSceneNumbers:directions,promptCompletedSceneNumbers:prompts,qaCompletedSceneNumbers:completed,correctionPendingSceneNumbers:uniqueSorted(batches.flatMap(batch=>[...batch.directionCorrectionSceneNumbers,...batch.promptCorrectionSceneNumbers])),context:deriveProductionContext(state)};
}

export function updateProductionBatch(session:GenerationSession,batchId:string,operation:ProductionOperation,patch:Partial<ProductionBatchState>={}):GenerationSession{
  const now=new Date().toISOString(),batches=session.batches.map(batch=>batch.id===batchId?{...batch,...patch,operation,lastCommittedAt:patch.lastCommittedAt??batch.lastCommittedAt,error:patch.error??null}:batch),active=batches.find(batch=>batch.id===batchId)!;
  return {...session,batches,operation,activeBatchId:batchId,currentBatch:active.index,batchStartScene:active.sceneNumbers[0]??null,batchEndScene:active.sceneNumbers.at(-1)??null,lastCommittedAt:['PLANNED','ALIGNED','DIRECTED','PROMPTS_GENERATED','COMPLETE'].includes(operation)?now:session.lastCommittedAt,error:patch.error??null};
}

export const mergeByNumber=<T extends {number:number}>(existing:T[],next:T[])=>{const values=new Map(existing.map(item=>[item.number,item]));next.forEach(item=>values.set(item.number,item));return [...values.values()].sort((a,b)=>a.number-b.number);};
export const isQuotaOrRateLimitError=(error:unknown)=>{const value=`${error instanceof Error?`${error.name} ${error.message}`:String(error)}`.toLowerCase();return /quota|resource[_ -]?exhausted|credit|billing|rate[_ -]?limit|too many requests|429/.test(value);};

export function invalidateFromScene(state:AppState,firstChangedScene:number):AppState{
  const keep=(number:number)=>number<firstChangedScene,plannedScenes=state.plannedScenes.filter(item=>keep(item.number)),sceneDirections=state.sceneDirections.filter(item=>keep(item.number)),visualPrompts=state.visualPrompts.filter(item=>keep(item.number));
  const session=createResumableProductionSession(state.voiceoverTranscription?.scenes||[],plannedScenes,sceneDirections,visualPrompts);
  return {...state,phase:1,plannedScenes,sceneDirections,visualPrompts,generationSession:synchronizeProductionSession(session,{...state,plannedScenes,sceneDirections,visualPrompts})};
}

export function firstChangedTranscriptionScene(previous:TimedScene[],next:TimedScene[]):number|null{
  const length=Math.max(previous.length,next.length);for(let index=0;index<length;index++){const a=previous[index],b=next[index];if(!a||!b||a.number!==b.number||a.start!==b.start||a.end!==b.end||a.text!==b.text||a.silent!==b.silent)return index+1;}return null;
}

export function replaceDirectionAndInvalidatePrompt(state:AppState,direction:SceneDirection):AppState{
  const sceneDirections=mergeByNumber(state.sceneDirections,[direction]),visualPrompts=state.visualPrompts.filter(prompt=>prompt.number!==direction.number),session=createResumableProductionSession(state.voiceoverTranscription?.scenes||[],state.plannedScenes,sceneDirections,visualPrompts);
  return {...state,phase:2,sceneDirections,visualPrompts,generationSession:synchronizeProductionSession(session,{...state,sceneDirections,visualPrompts})};
}
