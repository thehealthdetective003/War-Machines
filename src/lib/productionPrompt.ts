import { Type } from '@google/genai';
import type { AppState, ProductionContext, SceneDirection, T2VPrompt } from '../types';
import { buildOmniPromptContext, focusedContextCharacterSavings } from './omniPromptContext';
import { compileOmniPrompt, normalizeOmniSections } from './omniPromptCompiler';
import { isAdvisoryPromptQualityIssue, promptQualityIssues } from './promptQuality';
import { composeOmniPromptInstruction, PROMPT_COMPILER_VERSION, PROMPT_INSTRUCTION_VERSION } from './productionInstructions';
import { operationFingerprint } from './operationFingerprint';
import { isReusableFingerprint } from './operationFingerprint';
import { recordApiCall, recordLocalGraphicCompilation, recordPartialAcceptance, recordUnusedFieldsRemoved } from './apiDiagnostics';

export interface ContentGenerator {models:{generateContent:(request:any)=>Promise<{text?:string}>};}
const omniSectionsProperties={cinematography:{type:Type.STRING},subject:{type:Type.STRING},environment:{type:Type.STRING},style_lighting:{type:Type.STRING},exclusions:{type:Type.STRING}};
const omniResponseSchema={type:Type.ARRAY,items:{type:Type.OBJECT,required:['number','prompt_sections'],properties:{number:{type:Type.INTEGER},prompt_sections:{type:Type.OBJECT,required:Object.keys(omniSectionsProperties),properties:omniSectionsProperties}}}};

export interface PromptFailure {number:number;issues:string[];}
export interface PromptAttemptResult {accepted:T2VPrompt[];failed:PromptFailure[];reason:string|null;apiRequestedSceneNumbers:number[];locallyCompiledSceneNumbers:number[];}

const blockingIssues=(prompt:T2VPrompt,direction:SceneDirection)=>promptQualityIssues(prompt,direction).filter(issue=>!isAdvisoryPromptQualityIssue(issue));
const keywords=(direction:SceneDirection)=>[direction.subject,direction.primary_action,direction.environment_description,String(direction.visual_family||'').replaceAll('_',' ')].join(' ').toLowerCase().match(/[a-z0-9-]{4,}/g)?.filter((value,index,list)=>list.indexOf(value)===index).slice(0,10).join(', ')||'';
const metadata=(direction:SceneDirection)=>({number:direction.number,stage_id:direction.stage_id,state:direction.state,action_description:direction.primary_action,voiceover:direction.voiceover,stock_keywords:keywords(direction),continuity_notes:direction.continuity_from_previous});
const productText=(state:Pick<AppState,'topic'>)=>`${(state.topic as any)?._production_handoff?.product?.product_class||''} ${state.topic?.topic?.product||''}`;

export function promptOperationFingerprint(state:Pick<AppState,'topic'>,model:string,direction:SceneDirection,persistentContext?:ProductionContext):string{
  const kind=direction.graphic_spec?'local-graphic':'prompt';
  return operationFingerprint(kind,PROMPT_COMPILER_VERSION,{model:kind==='local-graphic'?'LOCAL':model,target:'omni-flash',instructionVersion:PROMPT_INSTRUCTION_VERSION,instruction:kind==='local-graphic'?'deterministic-graphic-compiler':composeOmniPromptInstruction([direction],productText(state)),persistentContext:persistentContext||null,promptContext:buildOmniPromptContext(state.topic,[direction])});
}

export function partitionReusablePrompts(existing:T2VPrompt[],directions:SceneDirection[],state:Pick<AppState,'topic'>,model:string,persistentContext?:ProductionContext){
  const directionByNumber=new Map(directions.map(direction=>[direction.number,direction])),reusable:T2VPrompt[]=[],staleSceneNumbers:number[]=[];
  existing.forEach(prompt=>{const direction=directionByNumber.get(prompt.number);if(!direction)return;const expected=promptOperationFingerprint(state,model,direction,persistentContext);if(isReusableFingerprint(prompt.operationFingerprint,expected))reusable.push(prompt);else staleSceneNumbers.push(prompt.number);});
  const reusableNumbers=new Set(reusable.map(prompt=>prompt.number));return {reusable:reusable.sort((a,b)=>a.number-b.number),staleSceneNumbers:[...new Set(staleSceneNumbers)].sort((a,b)=>a-b),missingDirections:directions.filter(direction=>!reusableNumbers.has(direction.number))};
}

export function compileLocalGraphicPrompt(state:Pick<AppState,'topic'>,direction:SceneDirection,persistentContext?:ProductionContext):{prompt:T2VPrompt|null;failure:PromptFailure|null}{
  if(!direction.graphic_spec)return {prompt:null,failure:{number:direction.number,issues:['MISSING_GRAPHIC_SPEC']}};
  const fingerprint=promptOperationFingerprint(state,'LOCAL',direction,persistentContext);
  const {sections}=normalizeOmniSections({},direction,state.topic);
  const prompt:T2VPrompt={...metadata(direction),video_prompt:compileOmniPrompt(sections,direction),quality_flags:[],omniSections:sections,operationFingerprint:fingerprint,generationSource:'LOCAL_GRAPHIC'};
  const issues=blockingIssues(prompt,direction);prompt.quality_flags=promptQualityIssues(prompt,direction);
  if(issues.length)return {prompt:null,failure:{number:direction.number,issues}};
  recordLocalGraphicCompilation();return {prompt,failure:null};
}

const failureReason=(failures:PromptFailure[])=>failures.length?`scene${failures.length===1?'':'s'} ${failures.map(item=>`${item.number} (${item.issues.join(', ')})`).join('; ')}`:null;

export async function requestPromptAttempt(ai:ContentGenerator,model:string,state:Pick<AppState,'topic'>,selected:SceneDirection[],qualityRetry?:string,persistentContext?:ProductionContext):Promise<PromptAttemptResult>{
  const localDirections=selected.filter(direction=>Boolean(direction.graphic_spec)),apiDirections=selected.filter(direction=>!direction.graphic_spec),accepted:T2VPrompt[]=[],failed:PromptFailure[]=[],locallyCompiledSceneNumbers:number[]=[];
  localDirections.forEach(direction=>{const result=compileLocalGraphicPrompt(state,direction,persistentContext);if(result.prompt){accepted.push(result.prompt);locallyCompiledSceneNumbers.push(direction.number);}else if(result.failure)failed.push(result.failure);});
  if(!apiDirections.length){recordPartialAcceptance(accepted.length,failed.length,Boolean(qualityRetry));return {accepted,failed,reason:failureReason(failed),apiRequestedSceneNumbers:[],locallyCompiledSceneNumbers};}
  const focused=buildOmniPromptContext(state.topic,apiDirections),instruction=composeOmniPromptInstruction(apiDirections,productText(state),qualityRetry);
  const focusedHandoff=(focused as any).authoritative_production_handoff,estimatedInputCharactersAvoided=focusedHandoff?focusedContextCharacterSavings(state.topic,focusedHandoff):0;
  recordApiCall('prompt',apiDirections.length,{correction:Boolean(qualityRetry),estimatedInputCharactersAvoided});recordUnusedFieldsRemoved(apiDirections.length*5);
  const response=await ai.models.generateContent({model,contents:JSON.stringify({persistent_context:persistentContext||null,prompt_context:focused}),config:{responseMimeType:'application/json',responseSchema:omniResponseSchema,systemInstruction:instruction}});
  let parsed:unknown;try{parsed=JSON.parse(response.text||'[]');}catch{parsed=null;}
  const rawItems=Array.isArray(parsed)?parsed:[];
  for(const direction of apiDirections){
    const matches=rawItems.filter((item:any)=>Number(item?.number)===direction.number);
    if(matches.length!==1){failed.push({number:direction.number,issues:[matches.length?'DUPLICATE_SCENE_OUTPUT':'MISSING_OR_MALFORMED_SCENE_OUTPUT']});continue;}
    const item:any=matches[0];
    try{
      if(!item.prompt_sections||typeof item.prompt_sections!=='object')throw new Error('MISSING_PROMPT_SECTIONS');const {sections}=normalizeOmniSections(item.prompt_sections,direction,state.topic);const prompt:T2VPrompt={...metadata(direction),video_prompt:compileOmniPrompt(sections,direction),quality_flags:[],omniSections:sections,operationFingerprint:promptOperationFingerprint(state,model,direction,persistentContext),generationSource:'API'};
      const allIssues=promptQualityIssues(prompt,direction),blocking=allIssues.filter(issue=>!isAdvisoryPromptQualityIssue(issue));prompt.quality_flags=allIssues;
      if(blocking.length)failed.push({number:direction.number,issues:blocking});else accepted.push(prompt);
    }catch(error){failed.push({number:direction.number,issues:[error instanceof Error?error.message:'INVALID_PROMPT_OUTPUT']});}
  }
  recordPartialAcceptance(accepted.length,failed.length,Boolean(qualityRetry));
  return {accepted:accepted.sort((a,b)=>a.number-b.number),failed,reason:failureReason(failed),apiRequestedSceneNumbers:apiDirections.map(item=>item.number),locallyCompiledSceneNumbers};
}
