import type { AppState, PhaseType, ProductionBatchState } from '../types';
import { validateProductionReadiness } from './setupValidation';
import { createResumableProductionSession, synchronizeProductionSession } from './productionSession';
import { normalizeCinematicPlans } from './cinematicPolicy';

export type SceneRepairKind='prompt'|'direction';

const cleanProductionStatus=(state:AppState)=>state.generationSession.status==='complete'||state.generationSession.status==='complete_with_warnings';
const allOutputsPresent=(state:AppState)=>{const total=state.voiceoverTranscription?.scenes.length||0;return total>0&&state.sceneDirections.length===total&&state.visualPrompts.length===total;};
export const isReviewAvailable=(state:AppState)=>cleanProductionStatus(state)&&allOutputsPresent(state);

export function projectWorkflowStage(state:AppState):PhaseType{
  if(isReviewAvailable(state))return 3;
  if(validateProductionReadiness(state).ready&&(state.generationSession.status!=='idle'||state.plannedScenes.length>0||state.sceneDirections.length>0||state.visualPrompts.length>0))return 2;
  return 1;
}

export function isWorkflowStageComplete(state:AppState,phase:PhaseType):boolean{
  if(phase===1)return validateProductionReadiness(state).ready;
  const clean=cleanProductionStatus(state)&&allOutputsPresent(state);
  if(phase===2)return clean;
  return clean;
}

export function prepareSceneRepair(state:AppState,sceneNumber:number,kind:SceneRepairKind):AppState{
  const scenes=state.voiceoverTranscription?.scenes||[],normalization=normalizeCinematicPlans(state.topic,scenes,state.plannedScenes,new Set(state.visualPrompts.filter(item=>item.number!==sceneNumber).map(item=>item.number))),plannedScenes=normalization.plans;
  const normalized=normalization.normalizedSceneNumbers.includes(sceneNumber);
  const sceneDirections=kind==='direction'||normalized?state.sceneDirections.filter(item=>item.number!==sceneNumber):state.sceneDirections;
  const visualPrompts=state.visualPrompts.filter(item=>item.number!==sceneNumber);
  let session=createResumableProductionSession(scenes,plannedScenes,sceneDirections,visualPrompts);
  const deferredRepairs=state.generationSession.deferredRepairs.filter(item=>item.sceneNumber!==sceneNumber||(kind==='prompt'&&item.operation==='DIRECTION'));
  const sceneReviews=state.generationSession.sceneReviews.filter(item=>item.sceneNumber!==sceneNumber||(kind==='prompt'&&item.operation==='DIRECTION'));
  session=synchronizeProductionSession({...session,status:'paused',pauseReason:'user',error:null,validationWarnings:state.generationSession.validationWarnings.filter(item=>item.sceneNumber!==sceneNumber),sceneReviews,deferredRepairs},{...state,plannedScenes,sceneDirections,visualPrompts});
  return {...state,phase:2,plannedScenes,sceneDirections,visualPrompts,generationSession:session};
}

export function prepareBatchRedirect(state:AppState,batchId:string):AppState{
  const batch=state.generationSession.batches.find(item=>item.id===batchId);if(!batch)return state;
  const numbers=new Set(batch.sceneNumbers),sceneDirections=state.sceneDirections.filter(item=>!numbers.has(item.number)),visualPrompts=state.visualPrompts.filter(item=>!numbers.has(item.number));
  const scenes=state.voiceoverTranscription?.scenes||[],plannedScenes=normalizeCinematicPlans(state.topic,scenes,state.plannedScenes,new Set(visualPrompts.map(item=>item.number))).plans;
  let session=createResumableProductionSession(scenes,plannedScenes,sceneDirections,visualPrompts);
  session=synchronizeProductionSession({...session,status:'paused',pauseReason:'user',error:null,validationWarnings:state.generationSession.validationWarnings.filter(item=>!numbers.has(item.sceneNumber)),sceneReviews:state.generationSession.sceneReviews.filter(item=>!numbers.has(item.sceneNumber)),deferredRepairs:state.generationSession.deferredRepairs.filter(item=>!numbers.has(item.sceneNumber))},{...state,plannedScenes,sceneDirections,visualPrompts});
  return {...state,phase:2,plannedScenes,sceneDirections,visualPrompts,generationSession:session};
}

export function batchStatusLabel(batch:ProductionBatchState):string{
  if(batch.operation==='COMPLETE')return 'Complete';
  if(batch.directionCorrectionSceneNumbers.length||batch.promptCorrectionSceneNumbers.length)return 'Needs correction';
  if(batch.operation==='QUEUED')return 'Queued';
  return batch.operation.toLowerCase().replaceAll('_',' ').replace(/\b\w/g,value=>value.toUpperCase());
}

export function lastDurableProductionPoint(state:AppState):string{
  const promptNumbers=state.visualPrompts.map(item=>item.number).sort((a,b)=>a-b),directionNumbers=state.sceneDirections.map(item=>item.number).sort((a,b)=>a-b);
  if(promptNumbers.length)return `Scene ${promptNumbers.at(-1)} · Prompt generated`;
  if(directionNumbers.length)return `Scene ${directionNumbers.at(-1)} · Direction generated`;
  const planned=state.plannedScenes.map(item=>item.number).sort((a,b)=>a-b);return planned.length?`Scene ${planned.at(-1)} · Planned`:'Setup inputs only';
}

export function pendingProductionPoint(state:AppState):string{
  const session=state.generationSession,scene=session.correctionPendingSceneNumbers[0]??session.pendingSceneNumbers[0]??session.batchStartScene;
  return scene?`Scene ${scene} · ${session.operation.toLowerCase().replaceAll('_',' ')}`:'No pending scene';
}
