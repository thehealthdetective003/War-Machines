import type { DeferredRepair, GenerationSession, ProductionBatchState, ProductionOperation, SceneReviewItem, ValidationFinding } from '../types';
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
  operation:'QUEUED',activeBatchId:null,batches:[],completedSceneNumbers:[],pendingSceneNumbers:[],directionCompletedSceneNumbers:[],promptCompletedSceneNumbers:[],qaCompletedSceneNumbers:[],correctionPendingSceneNumbers:[],pauseReason:null,context:emptyProductionContext(),validationWarnings:[],sceneReviews:[],deferredRepairs:[],
});

const operations:ProductionOperation[]=['QUEUED','PLANNING','PLANNED','ALIGNING','ALIGNED','DIRECTING','DIRECTION_CORRECTION','DIRECTED','GENERATING_PROMPTS','PROMPTS_GENERATED','PROMPT_CORRECTION','QA','COMPLETE'];
const numbers=(value:unknown)=>Array.isArray(value)?[...new Set(value.map(Number).filter(Number.isInteger))].sort((a,b)=>a-b):[];
const normalizeBatch=(value:unknown,index:number):ProductionBatchState|null=>{
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const batch=value as Partial<ProductionBatchState>,sceneNumbers=numbers(batch.sceneNumbers);if(!sceneNumbers.length)return null;
  const issues=batch.correctionIssues&&typeof batch.correctionIssues==='object'&&!Array.isArray(batch.correctionIssues)?Object.fromEntries(Object.entries(batch.correctionIssues).map(([key,value])=>[key,Array.isArray(value)?value.map(String):[]])):{};
  const alignmentSelections=Array.isArray(batch.alignmentSelections)?batch.alignmentSelections.filter(item=>item&&typeof item.group_id==='string'&&typeof item.operationFingerprint==='string'):[];
  return {id:String(batch.id||`BATCH_${String(index+1).padStart(3,'0')}`),index:Number.isInteger(Number(batch.index))?Number(batch.index):index+1,sceneNumbers,operation:operations.includes(batch.operation as ProductionOperation)?batch.operation as ProductionOperation:'QUEUED',directionCompletedSceneNumbers:numbers(batch.directionCompletedSceneNumbers),promptCompletedSceneNumbers:numbers(batch.promptCompletedSceneNumbers),qaCompletedSceneNumbers:numbers(batch.qaCompletedSceneNumbers),directionCorrectionCandidates:Array.isArray(batch.directionCorrectionCandidates)?batch.directionCorrectionCandidates.filter(item=>item&&Number.isInteger(Number(item.number))):[],promptCorrectionCandidates:Array.isArray(batch.promptCorrectionCandidates)?batch.promptCorrectionCandidates.filter(item=>item&&Number.isInteger(Number(item.number))):[],promptCorrectionSceneNumbers:numbers(batch.promptCorrectionSceneNumbers),directionCorrectionSceneNumbers:numbers(batch.directionCorrectionSceneNumbers),correctionIssues:issues,alignmentSelections:alignmentSelections as ProductionBatchState['alignmentSelections'],contextSnapshot:batch.contextSnapshot&&typeof batch.contextSnapshot==='object'?batch.contextSnapshot:null,correctionReason:typeof batch.correctionReason==='string'?batch.correctionReason:null,lastCommittedAt:typeof batch.lastCommittedAt==='string'?batch.lastCommittedAt:null,error:typeof batch.error==='string'?batch.error:null};
};

const normalizedReview=(value:unknown):SceneReviewItem|null=>{
  if(!value||typeof value!=='object'||Array.isArray(value))return null;const item=value as Partial<SceneReviewItem>;
  if(!Number.isInteger(Number(item.sceneNumber))||!['DIRECTION','PROMPT'].includes(String(item.operation)))return null;
  return {sceneNumber:Number(item.sceneNumber),operation:item.operation as SceneReviewItem['operation'],status:'NEEDS_REVIEW',repairAttempted:true,validationCodes:Array.isArray(item.validationCodes)?item.validationCodes.map(String).filter(Boolean):['SCENE_REVIEW_REQUIRED'],message:String(item.message||'Automatic repair was attempted once; the best available result was preserved.'),findings:Array.isArray(item.findings)?item.findings.filter(finding=>finding&&typeof finding.code==='string') as ValidationFinding[]:[],dependencyFingerprint:typeof item.dependencyFingerprint==='string'?item.dependencyFingerprint:undefined,candidateSource:['ORIGINAL','CORRECTION','LOCAL_FALLBACK','MIGRATED'].includes(String(item.candidateSource))?item.candidateSource as SceneReviewItem['candidateSource']:'MIGRATED',updatedAt:typeof item.updatedAt==='string'?item.updatedAt:new Date().toISOString()};
};

const reviewFromDeferred=(repair:DeferredRepair):SceneReviewItem=>({sceneNumber:repair.sceneNumber,operation:repair.operation,status:'NEEDS_REVIEW',repairAttempted:true,validationCodes:[repair.validationCode],message:repair.lastError||'Legacy scene repair remained unresolved.',findings:repair.finding?[repair.finding]:[],candidateSource:'MIGRATED',updatedAt:new Date().toISOString()});

export function normalizeGenerationSession(value:unknown,completedScenes=0):GenerationSession{
  if(!value||typeof value!=='object'||Array.isArray(value))return {...idleGenerationSession(),completedScenes};
  const session=value as Partial<GenerationSession>;
  const legacyRepairs=Array.isArray(session.deferredRepairs)?session.deferredRepairs.filter(item=>item&&Number.isInteger(Number(item.sceneNumber))&&item.severity==='BLOCKING_ERROR') as DeferredRepair[]:[];
  const reviews=[...(Array.isArray(session.sceneReviews)?session.sceneReviews.map(normalizedReview).filter((item):item is SceneReviewItem=>item!==null):[]),...legacyRepairs.map(reviewFromDeferred)];
  const mergedReviews=[...new Map(reviews.map(item=>[`${item.operation}:${item.sceneNumber}`,item])).values()].sort((a,b)=>a.sceneNumber-b.sceneNumber||a.operation.localeCompare(b.operation));
  const rawStatus=String(session.status),status=rawStatus==='deferred_repairs'?(session.operation==='COMPLETE'?'complete_with_warnings':'paused'):['idle','running','paused','interrupted','failed','complete','complete_with_warnings'].includes(rawStatus)?rawStatus as GenerationSession['status']:'idle';
  return {
    ...idleGenerationSession(),
    ...session,
    completedScenes:Number.isFinite(Number(session.completedScenes))?Number(session.completedScenes):completedScenes,
    status,
    operation:operations.includes(session.operation as ProductionOperation)?session.operation as ProductionOperation:'QUEUED',activeBatchId:typeof session.activeBatchId==='string'?session.activeBatchId:null,batches:Array.isArray(session.batches)?session.batches.map(normalizeBatch).filter((item):item is ProductionBatchState=>item!==null):[],completedSceneNumbers:numbers(session.completedSceneNumbers),pendingSceneNumbers:numbers(session.pendingSceneNumbers),directionCompletedSceneNumbers:numbers(session.directionCompletedSceneNumbers),promptCompletedSceneNumbers:numbers(session.promptCompletedSceneNumbers),qaCompletedSceneNumbers:numbers(session.qaCompletedSceneNumbers),correctionPendingSceneNumbers:numbers(session.correctionPendingSceneNumbers),pauseReason:session.pauseReason||null,context:session.context||emptyProductionContext(),validationWarnings:Array.isArray(session.validationWarnings)?session.validationWarnings.filter(item=>item&&typeof item.code==='string'&&item.severity==='WARNING') as ValidationFinding[]:[],sceneReviews:mergedReviews,deferredRepairs:[],
  };
}
