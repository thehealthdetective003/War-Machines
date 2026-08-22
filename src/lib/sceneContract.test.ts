import assert from 'node:assert/strict';
import test from 'node:test';
import type { AppState, PlannedScene, SceneDirection, TimedScene, TopicBrief } from '../types';
import type { VisualProductionHandoffV2 } from '../types/visualProductionV2';
import { idleGenerationSession } from './generationSession';
import { DEFAULT_V2_PRODUCTION_TEMPLATE, validateV2Semantics } from './handoffValidation';
import { mergeDirectionMetadata } from './sceneDirections';
import { applyResolvedSceneContract, clearResolvedEnvironmentRepairs, resolveSceneContract } from './sceneContract';
import { structuredPlanFindings } from './validationModel';

const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value));

function fixture(){
  const handoff=clone(DEFAULT_V2_PRODUCTION_TEMPLATE) as VisualProductionHandoffV2;
  const stage=handoff.production_stages[0],chapter=handoff.visual_story_plan.chapters[0],beat=chapter.visual_beats[0];
  const stageEnvironmentId=stage.environment_ids[0];
  const editorialEnvironmentId='ENV_EDITORIAL_OVERRIDE';
  handoff.environments.push({...clone(handoff.environments[0]),environment_id:editorialEnvironmentId,environment_name:'Generic editorial technical space',setting_scope:'GRAPHIC_SPACE',facility_claim_status:'GENERIC_NON_IDENTIFYING_VISUAL',exact_facility_name_if_verified:''});
  chapter.applicable_production_stage_ids=[stage.stage_id];
  beat.applicable_stage_ids=[stage.stage_id];
  beat.environment_ids=[editorialEnvironmentId];
  beat.required_product_state_code=stage.product_state_code;
  beat.generation_permission='T2V_ALLOWED';
  beat.preferred_media_routes=['GENERATED_T2V'];
  beat.visual_family='TECHNICAL_GRAPHIC';
  beat.story_function='EXPLAIN_HIDDEN_SYSTEM';
  beat.product_visibility='NONE';
  beat.reference_asset_ids=[];
  const topic={_production_handoff:handoff} as unknown as TopicBrief;
  const plan:PlannedScene={number:1,chapter_id:chapter.chapter_id,beat_id:beat.beat_id,contract_beat_id:beat.beat_id,visual_family:beat.visual_family,story_function:beat.story_function,visual_treatment:'MOTION_GRAPHIC_T2V',product_visibility:beat.product_visibility,stage_id:stage.stage_id,environment_ref:editorialEnvironmentId,state:stage.product_state_code,showdown_role:null,energy_level:'MEDIUM',camera_platform:null,graphic_spec:null,reference_asset_ids:[],required_visible_features:[],forbidden_elements:[],continuity_requirements:[],alignment_source:'ENGINE_BEAT',alignment_confidence:.99,alignment_claim:'Explain one hidden technical relationship'};
  return {handoff,topic,plan,beat,stage,chapter,stageEnvironmentId,editorialEnvironmentId};
}

test('explicit beat environment overrides the stage default for planning and validation',()=>{
  const {topic,plan,stageEnvironmentId,editorialEnvironmentId}=fixture();
  const resolved=resolveSceneContract(topic,plan);
  assert.deepEqual(resolved.allowedEnvironmentIds,[editorialEnvironmentId]);
  assert.equal(resolved.selectedEnvironmentId,editorialEnvironmentId);
  assert.equal(resolved.resolutionSources.environment,'BEAT');
  assert.notEqual(editorialEnvironmentId,stageEnvironmentId);
  assert.deepEqual(structuredPlanFindings(topic,plan),[]);
});

test('stage environments are the deterministic fallback when a beat has no environment',()=>{
  const {topic,plan,beat,stageEnvironmentId}=fixture();
  beat.environment_ids=[];
  const resolved=resolveSceneContract(topic,{...plan,environment_ref:''});
  assert.deepEqual(resolved.allowedEnvironmentIds,[stageEnvironmentId]);
  assert.equal(resolved.selectedEnvironmentId,stageEnvironmentId);
  assert.equal(resolved.resolutionSources.environment,'STAGE');
});

test('a scene outside the explicit beat environment remains a deterministic blocker',()=>{
  const {topic,plan,stageEnvironmentId}=fixture();
  const finding=structuredPlanFindings(topic,{...plan,environment_ref:stageEnvironmentId}).find(item=>item.code==='SCENE_ENVIRONMENT_NOT_ALLOWED');
  assert.equal(finding?.severity,'BLOCKING_ERROR');
  assert.equal(finding?.actual,stageEnvironmentId);
  assert.equal(finding?.structuredRuleSource,`${plan.beat_id}.environment_ids`);
  assert.equal(finding?.constraintSource,'BEAT');
  assert.deepEqual(finding?.allowedEnvironmentIds,[plan.environment_ref]);
  assert.equal(finding?.beatId,plan.beat_id);
  assert.equal(finding?.stageId,plan.stage_id);
});

test('handoff validation rejects a nonexistent beat environment before production',()=>{
  const {handoff,beat}=fixture();
  beat.environment_ids=['ENV_DOES_NOT_EXIST'];
  const finding=validateV2Semantics(handoff).find(item=>item.path.endsWith('/environment_ids')&&item.code==='broken-reference');
  assert.match(finding?.message||'',/ENV_DOES_NOT_EXIST/);
});

test('handoff validation rejects a reference-required beat without researched evidence',()=>{
  const {handoff,beat}=fixture();
  beat.generation_permission='REFERENCE_REQUIRED';beat.preferred_media_routes=['REFERENCE_IMAGE_I2V'];beat.reference_asset_ids=[];
  const finding=validateV2Semantics(handoff).find(item=>item.path.endsWith('/reference_asset_ids')&&/REFERENCE_REQUIRED/.test(item.message));
  assert.equal(finding?.code,'contract');
});

test('a multi-stage beat keeps its explicit editorial environment in each valid stage',()=>{
  const {handoff,topic,plan,beat,stage,editorialEnvironmentId}=fixture();
  const second={...clone(stage),stage_id:'STG_SECOND_CONTEXT',stage_number:stage.stage_number+1,environment_ids:[stage.environment_ids[0]]};
  handoff.production_stages.push(second);beat.applicable_stage_ids=[stage.stage_id,second.stage_id];
  for(const stageId of beat.applicable_stage_ids){
    const resolved=resolveSceneContract(topic,{...plan,stage_id:stageId,environment_ref:editorialEnvironmentId});
    assert.equal(resolved.selectedEnvironmentId,editorialEnvironmentId);
    assert.equal(structuredPlanFindings(topic,{...plan,stage_id:stageId,environment_ref:editorialEnvironmentId}).some(item=>item.severity==='BLOCKING_ERROR'),false);
  }
});

test('direction metadata locks the resolved environment against model output',()=>{
  const {topic,plan,stageEnvironmentId,editorialEnvironmentId}=fixture();
  const locked=applyResolvedSceneContract(topic,plan);
  const timed:TimedScene={number:1,start:0,end:6,duration:6,text:'Explain the relationship.',silent:false};
  const [direction]=mergeDirectionMetadata([{number:1,environment_ref:stageEnvironmentId}],[timed],[locked],6);
  assert.equal(direction.environment_ref,editorialEnvironmentId);
  assert.deepEqual(direction.allowed_environment_ids,[editorialEnvironmentId]);
  assert.equal(direction.constraint_sources?.environment,'BEAT');
});

test('a persisted false stage mismatch clears locally without touching paid artifacts',()=>{
  const {topic,plan,editorialEnvironmentId}=fixture();
  const locked=applyResolvedSceneContract(topic,plan),direction={...locked,environment_ref:editorialEnvironmentId} as SceneDirection;
  const prompt={number:1,action_description:'Existing action',video_prompt:'Existing paid prompt',voiceover:'Exact VO',stock_keywords:'technical'};
  const session=idleGenerationSession();session.status='deferred_repairs';session.correctionPendingSceneNumbers=[1];session.deferredRepairs=[{sceneNumber:1,operation:'DIRECTION',validationCode:'STAGE_ENVIRONMENT_MISMATCH',severity:'BLOCKING_ERROR',attempts:1,lastError:'Old validator rejected the beat environment',dependencies:['stage.environment_ids']}];
  const state={topic,plannedScenes:[locked],sceneDirections:[direction],visualPrompts:[prompt],generationSession:session} as unknown as AppState;
  const result=clearResolvedEnvironmentRepairs(state);
  assert.deepEqual(result.clearedSceneNumbers,[1]);
  assert.deepEqual(result.state.generationSession.deferredRepairs,[]);
  assert.equal(result.state.sceneDirections[0],direction);
  assert.equal(result.state.visualPrompts[0],prompt);
});

test('a genuine persisted environment mismatch is not cleared',()=>{
  const {topic,plan,stageEnvironmentId}=fixture();
  const invalid={...applyResolvedSceneContract(topic,plan),environment_ref:stageEnvironmentId},direction={...invalid} as SceneDirection;
  const session=idleGenerationSession();session.status='deferred_repairs';session.deferredRepairs=[{sceneNumber:1,operation:'DIRECTION',validationCode:'SCENE_ENVIRONMENT_NOT_ALLOWED',severity:'BLOCKING_ERROR',attempts:1,lastError:'Invalid environment',dependencies:['beat.environment_ids']}];
  const state={topic,plannedScenes:[invalid],sceneDirections:[direction],visualPrompts:[],generationSession:session} as unknown as AppState;
  assert.equal(clearResolvedEnvironmentRepairs(state).state.generationSession.deferredRepairs.length,1);
});

test('resolver provenance survives JSON export/import and reconstructs the same contract',()=>{
  const {topic,plan}=fixture(),locked=applyResolvedSceneContract(topic,plan);
  const exported=JSON.parse(JSON.stringify({topic,plannedScenes:[locked]}));
  const before=resolveSceneContract(topic,locked),after=resolveSceneContract(exported.topic,exported.plannedScenes[0]);
  assert.deepEqual({environment:after.selectedEnvironmentId,allowed:after.allowedEnvironmentIds,source:after.resolutionSources.environment,beat:after.beatId,stage:after.stageId},{environment:before.selectedEnvironmentId,allowed:before.allowedEnvironmentIds,source:before.resolutionSources.environment,beat:before.beatId,stage:before.stageId});
});
