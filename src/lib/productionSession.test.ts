import assert from 'node:assert/strict';
import test from 'node:test';
import type { AppState, PlannedScene, SceneDirection, T2VPrompt, TimedScene } from '../types';
import { normalizeGenerationSession } from './generationSession';
import { createProductionBatches, createProductionSession, createResumableProductionSession, firstChangedTranscriptionScene, invalidateFromScene, isQuotaOrRateLimitError, synchronizeProductionSession, updateProductionBatch } from './productionSession';

const scenes=(count:number):TimedScene[]=>Array.from({length:count},(_,index)=>({number:index+1,start:index*6,end:(index+1)*6,duration:6,text:`Complete idea ${index+1}${index===5?'.':''}`,silent:false}));
const plans=(count:number):PlannedScene[]=>Array.from({length:count},(_,index)=>({number:index+1,chapter_id:index<6?'CH01':'CH02',beat_id:`B${index+1}`,visual_family:'ASSEMBLY_PROCESS',story_function:index===5?'CONCLUDE_CHAPTER':'EXPLAIN_PROCESS',visual_treatment:'LIVE_ACTION_T2V',product_visibility:'PARTIAL',stage_id:index<6?'S01':'S02',environment_ref:'E01',state:'B',showdown_role:null,energy_level:'MEDIUM',camera_platform:null,graphic_spec:null,reference_asset_ids:[],required_visible_features:['product'],forbidden_elements:['finished product'],continuity_requirements:[],alignment_source:'ENGINE_BEAT',alignment_confidence:.9,alignment_claim:`Show action ${index+1}`}));
const direction=(number:number):SceneDirection=>({...plans(number).at(-1)!,start:(number-1)*6,end:number*6,duration:6,generation_duration_seconds:6,voiceover:`Complete idea ${number}`,silent:false,subject:'Product module',product_visual_state:'Incomplete State B',primary_action:'One tool seats one fastener',supporting_motion:'The fixture remains stable',environment_description:'Documented assembly bay',camera:{shot_scale:'MEDIUM',lens:'NORMAL',angle:'EYE_LEVEL',movement:'STATIC',movement_speed:'NONE'},lighting_and_material:'Neutral industrial lighting',continuity_from_previous:'Preserve the previous state',transition_to_next:'Hold on the secured module',required_visible_features:['product'],forbidden_elements:['finished product'],temporal_action:{opening_state:'The module rests in a fixture',primary_motion:'One tool approaches the fastener',physical_interaction:'The tool seats the fastener',mid_shot_progression:'The fastener settles progressively',ending_state:'The tool withdraws from the unchanged module'}});
const prompt=(number:number):T2VPrompt=>({number,action_description:'One tool seats one fastener',video_prompt:'A continuous six-second documentary shot of one tool seating one fastener.',voiceover:`Complete idea ${number}`,stock_keywords:'industrial assembly'});

test('creates semantic production batches near eight scenes and honors a strong natural boundary',()=>{
  const batches=createProductionBatches(scenes(18),plans(18));
  assert.deepEqual(batches.map(batch=>batch.sceneNumbers.length),[6,6,6]);
  assert.equal(batches[0].sceneNumbers.at(-1),6);
  assert.ok(batches.every(batch=>batch.sceneNumbers.length>=6&&batch.sceneNumbers.length<=10));
  assert.deepEqual(createProductionBatches(scenes(11),plans(11)).map(batch=>batch.sceneNumbers.length),[6,5]);
});

test('does not advance to prompts or the next batch before directions are represented durably',()=>{
  const timed=scenes(16),plan=plans(16),initial=createProductionSession(timed,plan),first=initial.batches[0];
  const directed=timed.filter(scene=>first.sceneNumbers.includes(scene.number)).map(scene=>direction(scene.number));
  let session=updateProductionBatch(initial,first.id,'DIRECTED');
  session=synchronizeProductionSession(session,{topic:null,voiceoverTranscription:{scenes:timed} as any,plannedScenes:plan,sceneDirections:directed,visualPrompts:[]});
  assert.equal(session.activeBatchId,first.id);
  assert.deepEqual(session.directionCompletedSceneNumbers,first.sceneNumbers);
  assert.deepEqual(session.promptCompletedSceneNumbers,[]);
  session=updateProductionBatch(session,first.id,'COMPLETE',{qaCompletedSceneNumbers:first.sceneNumbers});
  session=synchronizeProductionSession(session,{topic:null,voiceoverTranscription:{scenes:timed} as any,plannedScenes:plan,sceneDirections:directed,visualPrompts:first.sceneNumbers.map(prompt)});
  assert.equal(session.activeBatchId,session.batches[1].id);
});

test('resumes by skipping a fully completed batch and selecting the exact next operation',()=>{
  const timed=scenes(16),plan=plans(16),firstNumbers=createProductionBatches(timed,plan)[0].sceneNumbers;
  const session=createResumableProductionSession(timed,plan,firstNumbers.map(direction),firstNumbers.map(prompt));
  assert.equal(session.batches[0].operation,'COMPLETE');
  assert.equal(session.activeBatchId,session.batches[1].id);
  assert.equal(session.operation,'ALIGNED');
});

test('round-trips direction and prompt correction checkpoints without losing candidates',()=>{
  const timed=scenes(8),plan=plans(8),base=createProductionSession(timed,plan),batch=base.batches[0];
  const directionPending=updateProductionBatch(base,batch.id,'DIRECTION_CORRECTION',{directionCorrectionCandidates:[direction(3)],correctionReason:'semantic mismatch'});
  const restoredDirection=normalizeGenerationSession(JSON.parse(JSON.stringify(directionPending)));
  assert.equal(restoredDirection.batches[0].operation,'DIRECTION_CORRECTION');
  assert.equal(restoredDirection.batches[0].directionCorrectionCandidates[0].number,3);
  const promptPending=updateProductionBatch(restoredDirection,batch.id,'PROMPT_CORRECTION',{directionCorrectionCandidates:[],promptCorrectionSceneNumbers:[4],correctionReason:'quality gate'});
  const restoredPrompt=normalizeGenerationSession(JSON.parse(JSON.stringify(promptPending)));
  assert.equal(restoredPrompt.batches[0].operation,'PROMPT_CORRECTION');
  assert.deepEqual(restoredPrompt.batches[0].promptCorrectionSceneNumbers,[4]);
});

test('detects quota exhaustion without treating ordinary validation failures as quota errors',()=>{
  assert.equal(isQuotaOrRateLimitError(new Error('429 RESOURCE_EXHAUSTED: quota exceeded')),true);
  assert.equal(isQuotaOrRateLimitError(new Error('Scene 4 failed semantic alignment')),false);
});

test('invalidates only the edited transcription scene and all dependent later output',()=>{
  const timed=scenes(8),plan=plans(8),allDirections=timed.map(scene=>direction(scene.number)),allPrompts=timed.map(scene=>prompt(scene.number));
  const state={phase:3,topic:null,voiceoverTranscription:{scenes:timed} as any,plannedScenes:plan,sceneDirections:allDirections,visualPrompts:allPrompts,demoState:'approved',demoScenes:[],demoSceneNumbers:[],generationSession:createResumableProductionSession(timed,plan,allDirections,allPrompts)} as AppState;
  const invalidated=invalidateFromScene(state,5);
  assert.deepEqual(invalidated.plannedScenes.map(item=>item.number),[1,2,3,4]);
  assert.deepEqual(invalidated.sceneDirections.map(item=>item.number),[1,2,3,4]);
  assert.deepEqual(invalidated.visualPrompts.map(item=>item.number),[1,2,3,4]);
  assert.equal(invalidated.phase,1);
});

test('finds the first changed transcription scene and ignores identical imports',()=>{
  const previous=scenes(8),same=JSON.parse(JSON.stringify(previous)),changed=JSON.parse(JSON.stringify(previous));
  changed[5].text='A corrected complete idea.';
  assert.equal(firstChangedTranscriptionScene(previous,same),null);
  assert.equal(firstChangedTranscriptionScene(previous,changed),6);
});
