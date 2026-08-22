import type { AppState, PersistedAlignmentSelection, PlannedScene, ProductionContext, SceneDirection, SceneReviewItem, TimedScene, TopicBrief, ValidationFinding, ValidationSeverity } from '../types';
import type { AlignmentRequestGroup, VisualAlignmentSelection } from './visualAlignment';
import { validateAlignmentSelections } from './visualAlignment';
import { mergeDirectionMetadata } from './sceneDirections';
import { blockingFindings, repairableFindings, semanticDirectionFindings, structuredDirectionFindings, warningFindings } from './validationModel';
import { buildFocusedProductionContext, buildLegacyFocusedProductionContext } from './omniPromptContext';
import { ALIGNMENT_INSTRUCTION_VERSION, composeAlignmentInstruction, composeDirectionInstruction, DIRECTION_INSTRUCTION_VERSION } from './productionInstructions';
import { isReusableFingerprint, operationFingerprint } from './operationFingerprint';
import { sceneReviewDependencyFingerprint } from './reviewFingerprint';

export interface ItemFailure {id:string;number?:number;issues:string[];candidate?:SceneDirection;findings?:ValidationFinding[];severity?:ValidationSeverity;}

export function alignmentOperationFingerprint(model:string,request:AlignmentRequestGroup,focusedContext:unknown,persistentContext:ProductionContext|null):string{
  return operationFingerprint('alignment',ALIGNMENT_INSTRUCTION_VERSION,{model,request,focusedContext,persistentContext,instruction:composeAlignmentInstruction()});
}

export function partitionAlignmentResponse(requests:AlignmentRequestGroup[],raw:unknown,fingerprints:Map<string,string>):{accepted:PersistedAlignmentSelection[];failed:ItemFailure[]}{
  const items=Array.isArray(raw)?raw:[],accepted:PersistedAlignmentSelection[]=[],failed:ItemFailure[]=[];
  requests.forEach(request=>{
    const matches=items.filter((item:any)=>String(item?.group_id||'')===request.group_id);
    if(matches.length!==1){failed.push({id:request.group_id,issues:[matches.length?'DUPLICATE_GROUP_OUTPUT':'MISSING_OR_MALFORMED_GROUP_OUTPUT']});return;}
    try{const selection=validateAlignmentSelections([request],[matches[0]],{enforceSemanticChecks:false})[0];accepted.push({...selection,operationFingerprint:fingerprints.get(request.group_id)!});}
    catch(error){failed.push({id:request.group_id,issues:[error instanceof Error?error.message:'INVALID_ALIGNMENT_OUTPUT']});}
  });
  return {accepted,failed};
}

export function partitionReusableAlignmentSelections(existing:PersistedAlignmentSelection[],requests:AlignmentRequestGroup[],model:string,focusedContext:unknown,persistentContext:ProductionContext|null){
  const expected=new Map(requests.map(request=>[request.group_id,alignmentOperationFingerprint(model,request,focusedContext,persistentContext)])),reusable=existing.filter(selection=>isReusableFingerprint(selection.operationFingerprint,expected.get(selection.group_id)||'')),ids=new Set(reusable.map(selection=>selection.group_id));return {reusable,missingRequests:requests.filter(request=>!ids.has(request.group_id)),fingerprints:expected};
}

export function directionOperationFingerprint(state:Pick<AppState,'topic'>,model:string,scene:TimedScene,plan:PlannedScene,persistentContext:ProductionContext|null):string{
  const focusedContext=buildFocusedProductionContext(state.topic,[plan]);
  return operationFingerprint('direction',DIRECTION_INSTRUCTION_VERSION,{model,scene,plan,focusedContext,persistentContext,instruction:composeDirectionInstruction([plan],`${(state.topic as any)?._production_handoff?.product?.product_class||''} ${state.topic?.topic?.product||''}`)});
}

function legacyDirectionOperationFingerprint(state:Pick<AppState,'topic'>,model:string,scene:TimedScene,plan:PlannedScene,persistentContext:ProductionContext|null):string{
  const focusedContext=buildLegacyFocusedProductionContext(state.topic,[plan]);
  return operationFingerprint('direction',DIRECTION_INSTRUCTION_VERSION,{model,scene,plan,focusedContext,persistentContext,instruction:composeDirectionInstruction([plan],`${(state.topic as any)?._production_handoff?.product?.product_class||''} ${state.topic?.topic?.product||''}`)});
}

export function partitionDirectionResponse(raw:unknown,targetScenes:TimedScene[],targetPlan:PlannedScene[],generationDurationSeconds:number,fingerprints:Map<number,string>,options:{topic?:TopicBrief|null;afterRepair?:boolean}={}):{accepted:SceneDirection[];failed:ItemFailure[];warnings:ValidationFinding[]}{
  const items=Array.isArray(raw)?raw:[],accepted:SceneDirection[]=[],failed:ItemFailure[]=[],warnings:ValidationFinding[]=[];
  targetScenes.forEach(scene=>{
    const plan=targetPlan.find(item=>item.number===scene.number),matches=items.filter((item:any)=>Number(item?.number)===scene.number);
    if(!plan){failed.push({id:String(scene.number),number:scene.number,issues:['MISSING_PLANNED_SCENE']});return;}
    if(matches.length!==1){failed.push({id:String(scene.number),number:scene.number,issues:[matches.length?'DUPLICATE_SCENE_OUTPUT':'MISSING_OR_MALFORMED_SCENE_OUTPUT']});return;}
    const merged={...mergeDirectionMetadata([matches[0]],[scene],[plan],generationDurationSeconds)[0],operationFingerprint:fingerprints.get(scene.number)},structured=structuredDirectionFindings(options.topic||null,merged,scene,plan,generationDurationSeconds),semantic=blockingFindings(structured).length?[]:semanticDirectionFindings(merged,Boolean(options.afterRepair)),findings=[...structured,...semantic],blocking=blockingFindings(findings),repairable=repairableFindings(findings),advisory=warningFindings(findings);
    warnings.push(...advisory);
    if(blocking.length||repairable.length){const relevant=[...blocking,...repairable];failed.push({id:String(scene.number),number:scene.number,issues:relevant.map(item=>item.code),candidate:merged,findings:relevant,severity:blocking.length?'BLOCKING_ERROR':'REPAIRABLE_ERROR'});}
    else accepted.push(merged);
  });
  return {accepted,failed,warnings};
}

export function partitionReusableDirections(existing:SceneDirection[],targetScenes:TimedScene[],targetPlan:PlannedScene[],state:Pick<AppState,'topic'>,model:string,persistentContext:ProductionContext|null,options:{sceneReviews?:SceneReviewItem[]}={}){
  const planByNumber=new Map(targetPlan.map(plan=>[plan.number,plan])),sceneByNumber=new Map(targetScenes.map(scene=>[scene.number,scene])),expected=new Map(targetScenes.map(scene=>[scene.number,directionOperationFingerprint(state,model,scene,planByNumber.get(scene.number)!,persistentContext)])),warnings:ValidationFinding[]=[];
  const reusable=existing.filter(direction=>{const scene=sceneByNumber.get(direction.number),plan=planByNumber.get(direction.number);if(!scene||!plan)return false;const review=options.sceneReviews?.find(item=>item.sceneNumber===direction.number&&item.operation==='DIRECTION'),dependenciesMatch=!review?.dependencyFingerprint||review.dependencyFingerprint===sceneReviewDependencyFingerprint('DIRECTION',state.topic,scene,plan);if(!dependenciesMatch)return false;const current=isReusableFingerprint(direction.operationFingerprint,expected.get(direction.number)!),legacy=isReusableFingerprint(direction.operationFingerprint,legacyDirectionOperationFingerprint(state,model,scene,plan,persistentContext));if(!current&&!legacy)return false;if(review?.repairAttempted)return true;const structured=structuredDirectionFindings(state.topic,direction,scene,plan,direction.generation_duration_seconds);if(blockingFindings(structured).length)return false;warnings.push(...semanticDirectionFindings(direction,true));return true;});
  const numbers=new Set(reusable.map(direction=>direction.number)),staleSceneNumbers=existing.filter(direction=>expected.has(direction.number)&&!numbers.has(direction.number)).map(direction=>direction.number);return {reusable,missingScenes:targetScenes.filter(scene=>!numbers.has(scene.number)),staleSceneNumbers:[...new Set(staleSceneNumbers)].sort((a,b)=>a-b),fingerprints:expected,warnings};
}
