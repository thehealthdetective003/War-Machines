import type { TopicBrief, VoiceoverTranscription } from '../types';
import { getLifecycleStageCount } from './adaptiveSchema';
import { formatTimestamp } from './timedTranscript';

export interface HandoffSummary {stages:number;beats:number;environments:number;label:string;}
export const WORKFLOW_STAGES=[
  {id:1,label:'Setup',description:'Import and validate production inputs'},
  {id:2,label:'Production',description:'Generate, validate, and save every batch'},
  {id:3,label:'Review & Export',description:'Review exceptions and export the finished work'},
] as const;

export function validationPresentation(valid:boolean,errorCount=0):{label:string;detailOpen:boolean;tone:'success'|'error'}{
  return valid?{label:'Validated',detailOpen:false,tone:'success'}:{label:errorCount?`Validation failed · ${errorCount} issue${errorCount===1?'':'s'}`:'Validation failed',detailOpen:true,tone:'error'};
}
export function handoffSummary(topic:TopicBrief|null):HandoffSummary{
  if(!topic)return {stages:0,beats:0,environments:0,label:'No handoff loaded'};
  const source:any=topic._production_handoff,chapters=source?.visual_story_plan?.chapters||[],beats=chapters.reduce((total:number,chapter:any)=>total+(chapter.visual_beats?.length||0),0),environments=source?.environments?.length??topic.environments?.length??0;
  return {stages:source?.production_stages?.length??getLifecycleStageCount(topic),beats,environments,label:[`${source?.production_stages?.length??getLifecycleStageCount(topic)} stages`,beats?`${beats} visual beats`:null,`${environments} environments`].filter(Boolean).join(' · ')};
}

export function transcriptSummary(transcript:VoiceoverTranscription|null):string{
  if(!transcript)return 'No transcript loaded';
  return `${formatTimestamp(transcript.duration)} · ${transcript.scenes.length} scenes · ${transcript.sceneDurationSeconds}s clips`;
}

const operationLabels:Record<string,string>={QUEUED:'Queued',PLANNING:'Planning scenes…',PLANNED:'Scene plan ready',ALIGNING:'Aligning visuals to narration…',ALIGNED:'Visual alignment ready',DIRECTING:'Creating scene directions…',DIRECTION_CORRECTION:'Correcting scene directions…',DIRECTED:'Scene directions ready',GENERATING_PROMPTS:'Generating prompts…',PROMPTS_GENERATED:'Prompts ready',PROMPT_CORRECTION:'Refining prompts…',QA:'Running final checks…',COMPLETE:'Complete'};
export const productionOperationLabel=(operation?:string)=>operation&&operationLabels[operation]||'Working…';

export type ScenePresentationState='READY'|'WARNING'|'BLOCKED'|'PROMPTING'|'DIRECTING'|'QUEUED';
export function scenePresentationState(input:{hasDirection:boolean;hasPrompt:boolean;hasWarning:boolean;hasBlocker:boolean}):{state:ScenePresentationState;label:string}{
  if(input.hasBlocker)return {state:'BLOCKED',label:'Needs repair'};
  if(input.hasPrompt)return input.hasWarning?{state:'WARNING',label:'Review suggested'}:{state:'READY',label:'Ready'};
  if(input.hasDirection)return {state:'PROMPTING',label:'Generating prompt'};
  return {state:'DIRECTING',label:'Preparing direction'};
}

export const diagnosticsVisible=(setting:boolean)=>setting;
