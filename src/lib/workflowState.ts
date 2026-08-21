import type { AppState, PhaseType, ProductionBatchState } from '../types';
import { validateProductionReadiness } from './setupValidation';
import { createResumableProductionSession, synchronizeProductionSession } from './productionSession';

export type SceneRepairKind='prompt'|'direction';

export function projectWorkflowStage(state:AppState):PhaseType{
  const total=state.voiceoverTranscription?.scenes.length||0,complete=total>0&&state.generationSession.status==='complete'&&state.sceneDirections.length===total&&state.visualPrompts.length===total;
  if(complete)return 3;
  if(validateProductionReadiness(state).ready&&(state.generationSession.status!=='idle'||state.plannedScenes.length>0||state.sceneDirections.length>0||state.visualPrompts.length>0))return 2;
  return 1;
}

export function isWorkflowStageComplete(state:AppState,phase:PhaseType):boolean{
  if(phase===1)return validateProductionReadiness(state).ready;
  if(phase===2)return projectWorkflowStage(state)===3;
  return projectWorkflowStage(state)===3;
}

export function prepareSceneRepair(state:AppState,sceneNumber:number,kind:SceneRepairKind):AppState{
  const sceneDirections=kind==='direction'?state.sceneDirections.filter(item=>item.number!==sceneNumber):state.sceneDirections;
  const visualPrompts=state.visualPrompts.filter(item=>item.number!==sceneNumber);
  let session=createResumableProductionSession(state.voiceoverTranscription?.scenes||[],state.plannedScenes,sceneDirections,visualPrompts);
  session=synchronizeProductionSession({...session,status:'paused',pauseReason:'user',error:null},{...state,sceneDirections,visualPrompts});
  return {...state,phase:2,sceneDirections,visualPrompts,generationSession:session};
}

export function prepareBatchRedirect(state:AppState,batchId:string):AppState{
  const batch=state.generationSession.batches.find(item=>item.id===batchId);if(!batch)return state;
  const numbers=new Set(batch.sceneNumbers),sceneDirections=state.sceneDirections.filter(item=>!numbers.has(item.number)),visualPrompts=state.visualPrompts.filter(item=>!numbers.has(item.number));
  let session=createResumableProductionSession(state.voiceoverTranscription?.scenes||[],state.plannedScenes,sceneDirections,visualPrompts);
  session=synchronizeProductionSession({...session,status:'paused',pauseReason:'user',error:null},{...state,sceneDirections,visualPrompts});
  return {...state,phase:2,sceneDirections,visualPrompts,generationSession:session};
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
