import type { AppState, PersistedAlignmentSelection, PlannedScene, ProductionContext, SceneDirection, TimedScene } from '../types';
import type { AlignmentRequestGroup, VisualAlignmentSelection } from './visualAlignment';
import { validateAlignmentSelections } from './visualAlignment';
import { mergeDirectionMetadata, validateSceneDirections } from './sceneDirections';
import { directionSemanticIssues } from './directionSemantics';
import { buildFocusedProductionContext } from './flowPrompt';
import { ALIGNMENT_INSTRUCTION_VERSION, composeAlignmentInstruction, composeDirectionInstruction, DIRECTION_INSTRUCTION_VERSION } from './productionInstructions';
import { isReusableFingerprint, operationFingerprint } from './operationFingerprint';

export interface ItemFailure {id:string;number?:number;issues:string[];candidate?:SceneDirection;}

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

export function partitionDirectionResponse(raw:unknown,targetScenes:TimedScene[],targetPlan:PlannedScene[],generationDurationSeconds:number,fingerprints:Map<number,string>):{accepted:SceneDirection[];failed:ItemFailure[]}{
  const items=Array.isArray(raw)?raw:[],accepted:SceneDirection[]=[],failed:ItemFailure[]=[];
  targetScenes.forEach(scene=>{
    const plan=targetPlan.find(item=>item.number===scene.number),matches=items.filter((item:any)=>Number(item?.number)===scene.number);
    if(!plan){failed.push({id:String(scene.number),number:scene.number,issues:['MISSING_PLANNED_SCENE']});return;}
    if(matches.length!==1){failed.push({id:String(scene.number),number:scene.number,issues:[matches.length?'DUPLICATE_SCENE_OUTPUT':'MISSING_OR_MALFORMED_SCENE_OUTPUT']});return;}
    const merged=mergeDirectionMetadata([matches[0]],[scene],[plan],generationDurationSeconds)[0],structural=validateSceneDirections([merged],[scene],[plan],generationDurationSeconds),semantic=structural.length?[]:directionSemanticIssues(merged),issues=[...structural,...semantic];
    if(issues.length)failed.push({id:String(scene.number),number:scene.number,issues,candidate:structural.length?undefined:merged});
    else accepted.push({...merged,operationFingerprint:fingerprints.get(scene.number)});
  });
  return {accepted,failed};
}

export function partitionReusableDirections(existing:SceneDirection[],targetScenes:TimedScene[],targetPlan:PlannedScene[],state:Pick<AppState,'topic'>,model:string,persistentContext:ProductionContext|null){
  const planByNumber=new Map(targetPlan.map(plan=>[plan.number,plan])),expected=new Map(targetScenes.map(scene=>[scene.number,directionOperationFingerprint(state,model,scene,planByNumber.get(scene.number)!,persistentContext)])),reusable=existing.filter(direction=>expected.has(direction.number)&&isReusableFingerprint(direction.operationFingerprint,expected.get(direction.number)!)),numbers=new Set(reusable.map(direction=>direction.number)),staleSceneNumbers=existing.filter(direction=>expected.has(direction.number)&&!numbers.has(direction.number)).map(direction=>direction.number);return {reusable,missingScenes:targetScenes.filter(scene=>!numbers.has(scene.number)),staleSceneNumbers:[...new Set(staleSceneNumbers)].sort((a,b)=>a-b),fingerprints:expected};
}
