import Ajv2020, { type ErrorObject } from 'ajv/dist/2020';
import v2Schema from '../schemas/Modus_Visual_Production_Handoff_V2_Schema.json';
import v2Template from '../schemas/Modus_Visual_Production_Handoff_V2_Template.json';
import type { VisualProductionHandoffV2 } from '../types/visualProductionV2';
import { positiveSceneDuration, v2HandoffSceneDuration } from './sceneDuration';

export type HandoffFormat='v2'|'v1'|'legacy'|'unsupported'|'invalid';
export type HandoffStatusLabel='Valid V2'|'Valid Legacy V1'|'Invalid';
export interface HandoffValidationIssue { path:string; message:string; code:'schema'|'duplicate-id'|'broken-reference'|'unsupported-version'|'legacy'|'contract'; }
export interface HandoffValidationResult { valid:boolean; format:HandoffFormat; status:HandoffStatusLabel; version?:string; schemaErrors:HandoffValidationIssue[]; semanticErrors:HandoffValidationIssue[]; errors:HandoffValidationIssue[]; }

const ajv=new Ajv2020({allErrors:true,strict:false});
const validateV2Schema=ajv.compile(v2Schema);
export const DEFAULT_V2_PRODUCTION_TEMPLATE=v2Template as VisualProductionHandoffV2;

export function detectHandoffFormat(value:any):HandoffFormat {
  if(!value||typeof value!=='object'||Array.isArray(value))return 'invalid';
  const version=String(value.schema?.version||'');
  if(version==='2.0.0')return 'v2';
  if(value.schema?.name&&version&&version!=='1.0.0')return 'unsupported';
  if(value.product&&Array.isArray(value.production_stages))return 'v1';
  if(value.topic&&typeof value.topic==='object')return 'legacy';
  return 'invalid';
}

const schemaIssue=(error:ErrorObject):HandoffValidationIssue=>{
  const missing=error.keyword==='required'?`/${String((error.params as any).missingProperty||'')}`:'';
  const additional=error.keyword==='additionalProperties'?`/${String((error.params as any).additionalProperty||'')}`:'';
  return {path:`${error.instancePath||'/'}${missing}${additional}`.replace(/\/+/g,'/'),message:error.message||'Schema validation failed.',code:'schema'};
};
const issue=(path:string,message:string,code:HandoffValidationIssue['code']):HandoffValidationIssue=>({path,message,code});
const ids=(items:any[],field:string)=>new Set((items||[]).map(item=>String(item?.[field]||'')).filter(Boolean));

function duplicateIssues(items:any[],field:string,path:string):HandoffValidationIssue[]{
  const seen=new Set<string>(),duplicates=new Set<string>();
  (items||[]).forEach(item=>{const id=String(item?.[field]||'');if(!id)return;if(seen.has(id))duplicates.add(id);else seen.add(id);});
  return [...duplicates].map(id=>issue(path,`Duplicate ${field} "${id}".`, 'duplicate-id'));
}
function referenceIssues(values:unknown,path:string,known:Set<string>,kind:string):HandoffValidationIssue[]{
  const list=Array.isArray(values)?values:values?[values]:[];
  return list.map(String).filter(Boolean).filter(id=>!known.has(id)).map(id=>issue(path,`Unknown ${kind} reference "${id}".`,'broken-reference'));
}

export function validateV2Semantics(data:VisualProductionHandoffV2):HandoffValidationIssue[]{
  const errors:HandoffValidationIssue[]=[];
  const modules=ids(data.geometry_modules,'module_id'),assets=ids(data.reference_assets,'asset_id'),environments=ids(data.environments,'environment_id'),stages=ids(data.production_stages,'stage_id');
  errors.push(...duplicateIssues(data.geometry_modules,'module_id','/geometry_modules'));
  errors.push(...duplicateIssues(data.reference_assets,'asset_id','/reference_assets'));
  errors.push(...duplicateIssues(data.environments,'environment_id','/environments'));
  errors.push(...duplicateIssues(data.production_stages,'stage_id','/production_stages'));
  const actions=data.production_stages.flatMap(stage=>stage.stage_actions||[]);
  errors.push(...duplicateIssues(actions,'action_id','/production_stages/*/stage_actions'));
  const chapters=data.visual_story_plan.chapters||[];
  errors.push(...duplicateIssues(chapters,'chapter_id','/visual_story_plan/chapters'));
  const beats=chapters.flatMap(chapter=>chapter.visual_beats||[]);
  errors.push(...duplicateIssues(beats,'beat_id','/visual_story_plan/chapters/*/visual_beats'));
  const durationPath='/visual_story_plan/rhythm_policy/preferred_usable_scene_duration_seconds';
  const projectDuration=v2HandoffSceneDuration(data);
  const durationRange=data.visual_story_plan?.rhythm_policy?.preferred_usable_scene_duration_seconds;
  if(projectDuration===null){
    errors.push(issue(`${durationPath}/preferred`,'Project clip duration must be a positive number.','contract'));
  }else{
    (['minimum','preferred','maximum'] as const).forEach(field=>{
      const value=positiveSceneDuration(durationRange?.[field]);
      if(value===null||Math.abs(value-projectDuration)>0.000001)errors.push(issue(`${durationPath}/${field}`,`Duration must equal the project clip duration of ${projectDuration} seconds.`,'contract'));
    });
    chapters.forEach((chapter,chapterIndex)=>chapter.visual_beats.forEach((beat,beatIndex)=>{
      const beatBase=`/visual_story_plan/chapters/${chapterIndex}/visual_beats/${beatIndex}`;
      (['minimum_usable_duration_seconds','preferred_duration_seconds','maximum_duration_seconds'] as const).forEach(field=>{
        const value=positiveSceneDuration(beat[field]);
        if(value===null||Math.abs(value-projectDuration)>0.000001)errors.push(issue(`${beatBase}/${field}`,`Duration must equal the project clip duration of ${projectDuration} seconds.`,'contract'));
      });
    }));
  }
  data.production_stages.forEach((stage,index)=>{
    const base=`/production_stages/${index}`;
    errors.push(...referenceIssues(stage.environment_ids,`${base}/environment_ids`,environments,'environment'));
    errors.push(...referenceIssues(stage.geometry_control.primary_geometry_module_id,`${base}/geometry_control/primary_geometry_module_id`,modules,'geometry module'));
    errors.push(...referenceIssues(stage.geometry_control.secondary_geometry_module_ids,`${base}/geometry_control/secondary_geometry_module_ids`,modules,'geometry module'));
    errors.push(...referenceIssues(stage.visual_evidence.reference_asset_ids,`${base}/visual_evidence/reference_asset_ids`,assets,'reference asset'));
  });
  data.stage_transitions.forEach((transition,index)=>{
    errors.push(...referenceIssues(transition.from_stage_id,`/stage_transitions/${index}/from_stage_id`,stages,'production stage'));
    errors.push(...referenceIssues(transition.to_stage_id,`/stage_transitions/${index}/to_stage_id`,stages,'production stage'));
  });
  chapters.forEach((chapter,chapterIndex)=>{
    const base=`/visual_story_plan/chapters/${chapterIndex}`;
    errors.push(...referenceIssues(chapter.applicable_production_stage_ids,`${base}/applicable_production_stage_ids`,stages,'production stage'));
    chapter.visual_beats.forEach((beat,beatIndex)=>{
      const beatBase=`${base}/visual_beats/${beatIndex}`;
      errors.push(...referenceIssues(beat.applicable_stage_ids,`${beatBase}/applicable_stage_ids`,stages,'production stage'));
      errors.push(...referenceIssues(beat.environment_ids,`${beatBase}/environment_ids`,environments,'environment'));
      errors.push(...referenceIssues(beat.reference_asset_ids,`${beatBase}/reference_asset_ids`,assets,'reference asset'));
    });
  });
  return errors;
}

function legacyErrors(data:any,format:'v1'|'legacy'):HandoffValidationIssue[]{
  const errors:HandoffValidationIssue[]=[];
  if(format==='v1'){
    if(!data.schema?.name)errors.push(issue('/schema/name','schema.name is required.','legacy'));
    if(!data.product||typeof data.product!=='object')errors.push(issue('/product','product is required.','legacy'));
    if(!Array.isArray(data.environments))errors.push(issue('/environments','environments must be an array.','legacy'));
    if(!Array.isArray(data.production_stages))errors.push(issue('/production_stages','production_stages must be an array.','legacy'));
    if(!data.global_prompt_rules||typeof data.global_prompt_rules!=='object')errors.push(issue('/global_prompt_rules','global_prompt_rules is required.','legacy'));
  }else if(!data.topic?.title)errors.push(issue('/topic/title','topic.title is required.','legacy'));
  return errors;
}

export function validateVisualProductionHandoff(data:any):HandoffValidationResult {
  const source=data?._production_handoff||data;
  const format=detectHandoffFormat(source);let schemaErrors:HandoffValidationIssue[]=[];let semanticErrors:HandoffValidationIssue[]=[];
  if(format==='v2'){
    if(!validateV2Schema(source))schemaErrors=(validateV2Schema.errors||[]).map(schemaIssue);
    else semanticErrors=validateV2Semantics(source as VisualProductionHandoffV2);
  }else if(format==='v1'||format==='legacy')schemaErrors=legacyErrors(source,format);
  else if(format==='unsupported')schemaErrors=[issue('/schema/version',`Unsupported schema version "${String(source?.schema?.version||'')}".`,'unsupported-version')];
  else schemaErrors=[issue('/','File is not a recognized Modus production handoff or legacy topic brief.','schema')];
  const errors=[...schemaErrors,...semanticErrors],valid=errors.length===0;
  return {valid,format,status:valid?(format==='v2'?'Valid V2':'Valid Legacy V1'):'Invalid',version:source?.schema?.version,schemaErrors,semanticErrors,errors};
}
