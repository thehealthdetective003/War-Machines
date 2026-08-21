import type { DeferredRepair, GenerationSession, ProductionBatchState, ProductionOperation, ValidationFinding } from '../types';
import { emptyProductionContext } from './productionSession';

export const idleGenerationSession=():GenerationSession=>({
  status:'idle',
  totalBatches:0,
  currentBatch:0,
  batchStartScene:null,
  batchEndScene:null,
  completedScenes:0,
  startedAt:null,
  lastCommittedAt:null,
  error:null,
  operation:'QUEUED',activeBatchId:null,batches:[],completedSceneNumbers:[],pendingSceneNumbers:[],directionCompletedSceneNumbers:[],promptCompletedSceneNumbers:[],qaCompletedSceneNumbers:[],correctionPendingSceneNumbers:[],pauseReason:null,context:emptyProductionContext(),validationWarnings:[],deferredRepairs:[],
});

const operations:ProductionOperation[]=['QUEUED','PLANNING','PLANNED','ALIGNING','ALIGNED','DIRECTING','DIRECTION_CORRECTION','DIRECTED','GENERATING_PROMPTS','PROMPTS_GENERATED','PROMPT_CORRECTION','QA','COMPLETE'];
const numbers=(value:unknown)=>Array.isArray(value)?[...new Set(value.map(Number).filter(Number.isInteger))].sort((a,b)=>a-b):[];
const normalizeBatch=(value:unknown,index:number):ProductionBatchState|null=>{
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const batch=value as Partial<ProductionBatchState>,sceneNumbers=numbers(batch.sceneNumbers);if(!sceneNumbers.length)return null;
  const issues=batch.correctionIssues&&typeof batch.correctionIssues==='object'&&!Array.isArray(batch.correctionIssues)?Object.fromEntries(Object.entries(batch.correctionIssues).map(([key,value])=>[key,Array.isArray(value)?value.map(String):[]])):{};
  const alignmentSelections=Array.isArray(batch.alignmentSelections)?batch.alignmentSelections.filter(item=>item&&typeof item.group_id==='string'&&typeof item.operationFingerprint==='string'):[];
  return {id:String(batch.id||`BATCH_${String(index+1).padStart(3,'0')}`),index:Number.isInteger(Number(batch.index))?Number(batch.index):index+1,sceneNumbers,operation:operations.includes(batch.operation as ProductionOperation)?batch.operation as ProductionOperation:'QUEUED',directionCompletedSceneNumbers:numbers(batch.directionCompletedSceneNumbers),promptCompletedSceneNumbers:numbers(batch.promptCompletedSceneNumbers),qaCompletedSceneNumbers:numbers(batch.qaCompletedSceneNumbers),directionCorrectionCandidates:Array.isArray(batch.directionCorrectionCandidates)?batch.directionCorrectionCandidates.filter(item=>item&&Number.isInteger(Number(item.number))):[],promptCorrectionSceneNumbers:numbers(batch.promptCorrectionSceneNumbers),directionCorrectionSceneNumbers:numbers(batch.directionCorrectionSceneNumbers),correctionIssues:issues,alignmentSelections:alignmentSelections as ProductionBatchState['alignmentSelections'],contextSnapshot:batch.contextSnapshot&&typeof batch.contextSnapshot==='object'?batch.contextSnapshot:null,correctionReason:typeof batch.correctionReason==='string'?batch.correctionReason:null,lastCommittedAt:typeof batch.lastCommittedAt==='string'?batch.lastCommittedAt:null,error:typeof batch.error==='string'?batch.error:null};
};

export function normalizeGenerationSession(value:unknown,completedScenes=0):GenerationSession{
  if(!value||typeof value!=='object'||Array.isArray(value))return {...idleGenerationSession(),completedScenes};
  const session=value as Partial<GenerationSession>;
  return {
    ...idleGenerationSession(),
    ...session,
    completedScenes:Number.isFinite(Number(session.completedScenes))?Number(session.completedScenes):completedScenes,
    status:['idle','running','paused','interrupted','failed','complete','complete_with_warnings','deferred_repairs'].includes(String(session.status))?session.status as GenerationSession['status']:'idle',
    operation:operations.includes(session.operation as ProductionOperation)?session.operation as ProductionOperation:'QUEUED',activeBatchId:typeof session.activeBatchId==='string'?session.activeBatchId:null,batches:Array.isArray(session.batches)?session.batches.map(normalizeBatch).filter((item):item is ProductionBatchState=>item!==null):[],completedSceneNumbers:numbers(session.completedSceneNumbers),pendingSceneNumbers:numbers(session.pendingSceneNumbers),directionCompletedSceneNumbers:numbers(session.directionCompletedSceneNumbers),promptCompletedSceneNumbers:numbers(session.promptCompletedSceneNumbers),qaCompletedSceneNumbers:numbers(session.qaCompletedSceneNumbers),correctionPendingSceneNumbers:numbers(session.correctionPendingSceneNumbers),pauseReason:session.pauseReason||null,context:session.context||emptyProductionContext(),validationWarnings:Array.isArray(session.validationWarnings)?session.validationWarnings.filter(item=>item&&typeof item.code==='string'&&item.severity==='WARNING') as ValidationFinding[]:[],deferredRepairs:Array.isArray(session.deferredRepairs)?session.deferredRepairs.filter(item=>item&&Number.isInteger(Number(item.sceneNumber))&&item.severity==='BLOCKING_ERROR') as DeferredRepair[]:[],
  };
}
