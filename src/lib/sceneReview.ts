import type { AppState, PlannedScene, SceneDirection, SceneReviewItem, T2VPrompt, TimedScene, TopicBrief, ValidationFinding } from '../types';
import { mergeDirectionMetadata } from './sceneDirections';
import { resolveSceneContract } from './sceneContract';
import { compileFallbackPrompt } from './productionPrompt';
import { mergeByNumber, mergeSceneReviews, synchronizeProductionSession } from './productionSession';
import { sceneReviewDependencyFingerprint } from './reviewFingerprint';

export interface ReviewableFailure<T> {number?:number;issues:string[];candidate?:T;findings?:ValidationFinding[];}

export function chooseBestAvailable<T>(original:ReviewableFailure<T>|undefined,correction:ReviewableFailure<T>|undefined,fallback:T):{candidate:T;source:SceneReviewItem['candidateSource'];failure:ReviewableFailure<T>|undefined}{
  const originalUsable=Boolean(original?.candidate),correctionUsable=Boolean(correction?.candidate);
  if(correctionUsable&&(!originalUsable||(correction?.issues.length||0)<(original?.issues.length||0)))return {candidate:correction!.candidate!,source:'CORRECTION',failure:correction};
  if(originalUsable)return {candidate:original!.candidate!,source:'ORIGINAL',failure:original};
  if(correctionUsable)return {candidate:correction!.candidate!,source:'CORRECTION',failure:correction};
  return {candidate:fallback,source:'LOCAL_FALLBACK',failure:correction||original};
}

export function sceneReviewFromFailure<T>(sceneNumber:number,operation:'DIRECTION'|'PROMPT',selected:{candidate:T;source:SceneReviewItem['candidateSource'];failure:ReviewableFailure<T>|undefined},fallbackCode:string,dependencyFingerprint:string):SceneReviewItem{
  const findings=selected.failure?.findings||[],validationCodes=selected.failure?.issues?.length?selected.failure.issues:[fallbackCode];
  return {sceneNumber,operation,status:'NEEDS_REVIEW',repairAttempted:true,validationCodes,message:`Automatic ${operation.toLowerCase()} repair was attempted once. The best available result was preserved for review.`,findings,dependencyFingerprint,candidateSource:selected.source,updatedAt:new Date().toISOString()};
}

const productName=(topic:TopicBrief|null)=>String((topic as any)?._production_handoff?.product?.official_name||topic?.topic?.product||topic?.topic?.title||'assigned product').trim();

export function buildFallbackDirection(topic:TopicBrief|null,scene:TimedScene,plan:PlannedScene,generationDurationSeconds:number,fingerprint='legacy-preserved-v13'):SceneDirection{
  const contract=resolveSceneContract(topic,plan),environment:any=contract.environment||{},subject=plan.alignment_claim||plan.required_visible_features[0]||productName(topic),action=plan.alignment_claim||scene.text||`Hold ${subject} in one stable documentary view`;
  const raw={number:scene.number,subject,product_visual_state:`State ${plan.state} ${String(plan.product_visibility||'PARTIAL').toLowerCase().replaceAll('_',' ')} view`,primary_action:action,supporting_motion:'Only physically necessary supporting motion remains restrained',environment_description:environment.environment_name||environment.facility_type||environment.geographic_or_industrial_context||'Engine-authorized non-identifying production environment',camera:{shot_scale:contract.preferredShotScales[0]||'MEDIUM',lens:'NORMAL',angle:'EYE_LEVEL',movement:contract.preferredCameraMovements[0]||'STATIC',movement_speed:contract.preferredCameraMovements.length?'SLOW':'NONE'},lighting_and_material:environment.lighting||'Neutral documentary lighting with physically consistent materials',continuity_from_previous:contract.continuityRequirements.join(' ')||'Preserve the assigned product state and configuration',transition_to_next:'Hold the stable ending state for the next cut',required_visible_features:contract.requiredVisibleFeatures.length?contract.requiredVisibleFeatures:[subject],forbidden_elements:contract.forbiddenElements.length?contract.forbiddenElements:['readable generated text','unsupported product transformation'],temporal_action:{opening_state:`${subject} is established in the assigned environment`,primary_motion:action,physical_interaction:'All visible motion remains physically plausible and limited to the assigned action',mid_shot_progression:'The single action progresses without changing product configuration',ending_state:'The subject holds in the same assigned state and environment'}};
  return {...mergeDirectionMetadata([raw],[scene],[plan],generationDurationSeconds)[0],operationFingerprint:fingerprint};
}

export function materializeReviewedOutputs(state:AppState,generationDurationSeconds:number):{state:AppState;materializedSceneNumbers:number[]}{
  let sceneDirections=[...state.sceneDirections],visualPrompts=[...state.visualPrompts],reviews=[...state.generationSession.sceneReviews],materializedSceneNumbers:number[]=[];
  for(const review of [...reviews]){
    const scene=state.voiceoverTranscription?.scenes.find(item=>item.number===review.sceneNumber),plan=state.plannedScenes.find(item=>item.number===review.sceneNumber);if(!scene||!plan)continue;
    let direction=sceneDirections.find(item=>item.number===review.sceneNumber);
    if(!direction){const batch=state.generationSession.batches.find(item=>item.sceneNumbers.includes(review.sceneNumber)),stored=batch?.directionCorrectionCandidates.find(item=>item.number===review.sceneNumber);direction=stored?{...stored,operationFingerprint:stored.operationFingerprint||'legacy-preserved-v13'}:buildFallbackDirection(state.topic,scene,plan,generationDurationSeconds);sceneDirections=mergeByNumber(sceneDirections,[direction]);materializedSceneNumbers.push(scene.number);
      if(review.operation==='PROMPT')reviews=mergeSceneReviews(reviews,[{...review,operation:'DIRECTION',validationCodes:['MIGRATED_MISSING_DIRECTION'],message:'A local best-effort direction was restored for a legacy unresolved scene.',dependencyFingerprint:sceneReviewDependencyFingerprint('DIRECTION',state.topic,scene,plan),candidateSource:stored?'MIGRATED':'LOCAL_FALLBACK',updatedAt:new Date().toISOString()}]);
    }
    if(!visualPrompts.some(item=>item.number===scene.number)){const prompt=compileFallbackPrompt(state,direction,'LOCAL_REVIEW',undefined,'legacy-preserved-v13');visualPrompts=mergeByNumber(visualPrompts,[prompt]);materializedSceneNumbers.push(scene.number);}
    reviews=reviews.map(item=>item===review||item.sceneNumber===review.sceneNumber&&item.operation===review.operation?{...item,dependencyFingerprint:sceneReviewDependencyFingerprint(item.operation,state.topic,scene,plan,direction)}:item);
  }
  const reviewedNumbers=new Set(reviews.map(item=>item.sceneNumber)),batches=state.generationSession.batches.map(batch=>({...batch,directionCorrectionCandidates:batch.directionCorrectionCandidates.filter(item=>!reviewedNumbers.has(item.number)),promptCorrectionCandidates:batch.promptCorrectionCandidates.filter(item=>!reviewedNumbers.has(item.number)),directionCorrectionSceneNumbers:batch.directionCorrectionSceneNumbers.filter(number=>!reviewedNumbers.has(number)),promptCorrectionSceneNumbers:batch.promptCorrectionSceneNumbers.filter(number=>!reviewedNumbers.has(number)),correctionIssues:Object.fromEntries(Object.entries(batch.correctionIssues).filter(([number])=>!reviewedNumbers.has(Number(number))))}));
  let next={...state,sceneDirections,visualPrompts,generationSession:{...state.generationSession,batches,sceneReviews:reviews,deferredRepairs:[]}};
  next={...next,generationSession:synchronizeProductionSession(next.generationSession,next)};return {state:next,materializedSceneNumbers:[...new Set(materializedSceneNumbers)].sort((a,b)=>a-b)};
}
