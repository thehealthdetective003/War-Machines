import assert from 'node:assert/strict';
import test from 'node:test';
import type { AppState, PlannedScene, SceneDirection, SceneReviewItem, T2VPrompt, TimedScene } from '../types';
import { partitionReusableDirections, directionOperationFingerprint } from './productionApi';
import { partitionReusablePrompts, promptOperationFingerprint } from './productionPrompt';
import { createProductionSession } from './productionSession';
import { sceneReviewDependencyFingerprint } from './reviewFingerprint';
import { chooseBestAvailable, materializeReviewedOutputs, sceneReviewFromFailure } from './sceneReview';

const scene:TimedScene={number:1,start:0,end:6,duration:6,text:'One documented assembly action occurs.',silent:false};
const plan:PlannedScene={number:1,chapter_id:'CH01',beat_id:'B01',visual_family:'ASSEMBLY_PROCESS',story_function:'EXPLAIN_PROCESS',visual_treatment:'LIVE_ACTION_T2V',product_visibility:'PARTIAL',stage_id:'S01',environment_ref:'E01',state:'B',showdown_role:null,energy_level:'MEDIUM',camera_platform:null,graphic_spec:null,reference_asset_ids:[],required_visible_features:['assembly part'],forbidden_elements:['finished product'],continuity_requirements:[],alignment_source:'ENGINE_BEAT',alignment_confidence:.9,alignment_claim:'Show one documented assembly action'};
const direction=(fingerprint='legacy-preserved-v13'):SceneDirection=>({...plan,start:0,end:6,duration:6,generation_duration_seconds:6,voiceover:scene.text,silent:false,subject:'Assembly part',product_visual_state:'Incomplete State B',primary_action:'One tool seats one fastener',supporting_motion:'The fixture stays stable',environment_description:'Documented production bay',camera:{shot_scale:'MEDIUM',lens:'NORMAL',angle:'EYE_LEVEL',movement:'STATIC',movement_speed:'NONE'},lighting_and_material:'Neutral documentary lighting',continuity_from_previous:'Preserve State B',transition_to_next:'Hold the secured part',required_visible_features:['assembly part'],forbidden_elements:['finished product'],temporal_action:{opening_state:'The part rests in its fixture',primary_motion:'One tool approaches one fastener',physical_interaction:'The tool seats the fastener',mid_shot_progression:'The fastener settles progressively',ending_state:'The tool withdraws from the unchanged part'},operationFingerprint:fingerprint});
const prompt=(fingerprint:string):T2VPrompt=>({number:1,action_description:'One tool seats one fastener',video_prompt:'A continuous documentary view of one tool seating one fastener while the fixture remains stable.',voiceover:scene.text,stock_keywords:'assembly part, fastener',operationFingerprint:fingerprint,generationSource:'API'});
const review=(operation:'DIRECTION'|'PROMPT',dependencyFingerprint?:string):SceneReviewItem=>({sceneNumber:1,operation,status:'NEEDS_REVIEW',repairAttempted:true,validationCodes:['UNRESOLVED_TEST_CONCERN'],message:'Best available output preserved after one repair.',findings:[],dependencyFingerprint,candidateSource:'CORRECTION',updatedAt:'now'});

test('best-result selection prefers fewer findings and never requires another repair',()=>{
  const original={issues:['A','B'],candidate:'original'},correction={issues:['A'],candidate:'correction'};
  assert.deepEqual(chooseBestAvailable(original,correction,'fallback'),{candidate:'correction',source:'CORRECTION',failure:correction});
  const worse={issues:['A','B','C'],candidate:'worse'};
  assert.equal(chooseBestAvailable(original,worse,'fallback').candidate,'original');
  assert.equal(chooseBestAvailable(undefined,undefined,'fallback').source,'LOCAL_FALLBACK');
});

test('review state records exactly one attempted repair and the unresolved codes',()=>{
  const selected=chooseBestAvailable({issues:['FIRST'],candidate:'original'},{issues:['SECOND'],candidate:'correction'},'fallback'),item=sceneReviewFromFailure(1,'DIRECTION',selected,'FALLBACK','dependency');
  assert.equal(item.status,'NEEDS_REVIEW');
  assert.equal(item.repairAttempted,true);
  assert.deepEqual(item.validationCodes,['FIRST']);
  assert.equal(item.dependencyFingerprint,'dependency');
});

test('legacy unresolved scenes are completed locally with exportable direction and prompt output',()=>{
  const session=createProductionSession([scene],[plan]);
  session.sceneReviews=[review('DIRECTION')];
  session.batches[0].directionCorrectionSceneNumbers=[1];
  session.batches[0].promptCorrectionSceneNumbers=[1];
  const state:AppState={projectSchemaVersion:17,projectName:'Review migration',projectFormat:'standard-lifecycle',phase:2,topic:null,plannedScenes:[plan],sceneDirections:[],masterVoiceoverScript:scene.text,voiceoverTranscription:{audioFileName:'voice.json',duration:6,language:'en',languageProbability:1,model:'external',computeType:'external',text:scene.text,segments:[],words:[],sceneDurationSeconds:6,scenes:[scene],importedAt:'now'},visualPrompts:[],generationSession:session};
  const result=materializeReviewedOutputs(state,6);
  assert.deepEqual(result.materializedSceneNumbers,[1]);
  assert.equal(result.state.sceneDirections.length,1);
  assert.equal(result.state.visualPrompts.length,1);
  assert.equal(result.state.visualPrompts[0].generationSource,'LOCAL_FALLBACK');
  assert.equal(result.state.generationSession.sceneReviews[0].repairAttempted,true);
  assert.ok(result.state.generationSession.sceneReviews[0].dependencyFingerprint);
  assert.deepEqual(result.state.generationSession.batches[0].directionCorrectionSceneNumbers,[]);
  assert.deepEqual(result.state.generationSession.batches[0].promptCorrectionSceneNumbers,[]);
});

test('reviewed paid output is reused without another API attempt until its dependencies change',()=>{
  const directionFingerprint=directionOperationFingerprint({topic:null},'model',scene,plan,null),savedDirection=direction(directionFingerprint),directionDependency=sceneReviewDependencyFingerprint('DIRECTION',null,scene,plan);
  const directions=partitionReusableDirections([savedDirection],[scene],[plan],{topic:null},'model',null,{sceneReviews:[review('DIRECTION',directionDependency)]});
  assert.equal(directions.reusable.length,1);
  assert.deepEqual(directions.missingScenes,[]);
  const changedScene={...scene,text:'The dependency changed.'},changedDirections=partitionReusableDirections([savedDirection],[changedScene],[plan],{topic:null},'model',null,{sceneReviews:[review('DIRECTION',directionDependency)]});
  assert.deepEqual(changedDirections.staleSceneNumbers,[1]);

  const promptFingerprint=promptOperationFingerprint({topic:null},'model',savedDirection),savedPrompt=prompt(promptFingerprint),promptDependency=sceneReviewDependencyFingerprint('PROMPT',null,scene,plan,savedDirection);
  const prompts=partitionReusablePrompts([savedPrompt],[savedDirection],{topic:null},'model',undefined,{sceneReviews:[review('PROMPT',promptDependency)]});
  assert.equal(prompts.reusable.length,1);
  const changedDirection={...savedDirection,primary_action:'A changed action'},changedPrompts=partitionReusablePrompts([savedPrompt],[changedDirection],{topic:null},'model',undefined,{sceneReviews:[review('PROMPT',promptDependency)]});
  assert.deepEqual(changedPrompts.staleSceneNumbers,[1]);
});
