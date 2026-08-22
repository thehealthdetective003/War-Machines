import assert from 'node:assert/strict';
import test from 'node:test';
import { migrateProject, projectSceneDuration } from './projectMigration';
import type { AppState } from '../types';
import template from '../schemas/Modus_Visual_Production_Handoff_V2_Template.json';
import { normalizeProductionHandoff } from './productionTemplate';
import { idleGenerationSession } from './generationSession';
import { createProductionSession } from './productionSession';
import { applyResolvedSceneContract } from './sceneContract';

const initial = { projectSchemaVersion: 15, projectName: 'Untitled', projectFormat: 'standard-lifecycle', phase: 1, topic: null, plannedScenes:[], sceneDirections: [], masterVoiceoverScript: '', voiceoverTranscription: null, visualPrompts: [], generationSession:idleGenerationSession() } as AppState;
const plan={number:1,chapter_id:'CH01',beat_id:'B01',visual_family:'ASSEMBLY_PROCESS',story_function:'EXPLAIN_PROCESS',visual_treatment:'LIVE_ACTION_T2V',product_visibility:'PARTIAL',stage_id:'S01',environment_ref:'E01',state:'B',showdown_role:null,energy_level:'MEDIUM',camera_platform:null,graphic_spec:null,reference_asset_ids:[],required_visible_features:['steel'],forbidden_elements:['finished product'],continuity_requirements:[],alignment_source:'ENGINE_BEAT',alignment_confidence:.9,alignment_claim:'Show steel assembly'} as const;
const temporal_action={opening_state:'The part rests in its jig',primary_motion:'A worker lowers the tool',physical_interaction:'The tool contacts the part',mid_shot_progression:'The fastener seats progressively',ending_state:'The tool lifts away from the secured part'};

test('rejects Hybrid projects', () => assert.equal(migrateProject({ creationMode: 'hybrid-split' }, initial, 10).state, null));
test('moves legacy projects without both setup inputs back to Setup', () => {
  const result = migrateProject({ topic: { topic: { title: 'X' } }, phase: 4, phase4Mode: 'image-animation', visualPrompts: [{ image_prompt: 'x' }] }, initial, 10);
  assert.equal(result.state?.phase, 1);
  assert.deepEqual(result.state?.visualPrompts, []);
});

test('round-trips a complete 8-second T2V project without changing its timeline', () => {
  const scene = { ...plan,number:1,start:0,end:8,duration:8,voiceover:'Hello',silent:false,state:'A',subject:'Steel',product_visual_state:'Raw',primary_action:'Moves',supporting_motion:'None',environment_description:'Factory',camera:{shot_scale:'wide',lens:'35mm',angle:'eye',movement:'track',movement_speed:'slow'},lighting_and_material:'Cool steel',continuity_from_previous:'Opening',transition_to_next:'Cut',required_visible_features:['steel'],forbidden_elements:['finished product'],temporal_action } as const;
  const raw = { ...initial, phase:3, topic:{topic:{title:'X'}}, voiceoverTranscription:{audioFileName:'vo.json',duration:8,language:'en',languageProbability:1,model:'external',computeType:'external',text:'Hello',segments:[],words:[{text:'Hello',start:0,end:1,probability:1}],sceneDurationSeconds:8,scenes:[{number:1,start:0,end:8,duration:8,text:'Hello',silent:false}],importedAt:'now'}, plannedScenes:[plan],sceneDirections:[scene], visualPrompts:[{number:1,action_description:'Moves',video_prompt:'Prompt',voiceover:'Hello',stock_keywords:'steel'}] };
  const parsed = JSON.parse(JSON.stringify(raw));
  assert.equal(projectSceneDuration(parsed, 10), 8);
  const result = migrateProject(parsed, initial, 10);
  assert.equal(result.state?.phase, 3);
  assert.equal(result.state?.voiceoverTranscription?.sceneDurationSeconds, 8);
  assert.equal(result.state?.visualPrompts.length, 1);
  assert.equal(result.state?.projectSchemaVersion, 16);
  assert.equal('apiKey' in parsed, false);

  const partial = JSON.parse(JSON.stringify(raw));
  partial.voiceoverTranscription.duration=16;
  partial.voiceoverTranscription.scenes.push({number:2,start:8,end:16,duration:8,text:'Next',silent:false});
  partial.plannedScenes.push({...plan,number:2});partial.sceneDirections.push({...scene,number:2,start:8,end:16,voiceover:'Next'});
  const partialResult=migrateProject(partial,initial,8);
  assert.equal(partialResult.state?.sceneDirections.length,2);
  assert.equal(partialResult.state?.visualPrompts.length,1);
});

test('schema 11 projects preserve inputs but reset downstream output for automatic realignment',()=>{
  const scene={...plan,number:1,start:0,end:8,duration:8,generation_duration_seconds:8,voiceover:'Hello',silent:false,subject:'Steel',product_visual_state:'Raw',primary_action:'Moves',supporting_motion:'None',environment_description:'Factory',camera:{shot_scale:'wide',lens:'35mm',angle:'eye',movement:'track',movement_speed:'slow'},lighting_and_material:'Cool steel',continuity_from_previous:'Opening',transition_to_next:'Cut',required_visible_features:['steel'],forbidden_elements:['finished product'],temporal_action};
  const raw:any={...initial,projectSchemaVersion:11,phase:3,topic:{topic:{title:'X'}},voiceoverTranscription:{duration:8,sceneDurationSeconds:8,text:'Hello',words:[],scenes:[{number:1,start:0,end:8,duration:8,text:'Hello',silent:false}]},plannedScenes:[plan],sceneDirections:[scene],visualPrompts:[{number:1,video_prompt:'old',action_description:'old',voiceover:'Hello',stock_keywords:''}]};
  const result=migrateProject(raw,initial,8);assert.equal(result.state?.projectSchemaVersion,16);assert.equal(result.state?.phase,2);assert.deepEqual(result.state?.plannedScenes,[]);assert.deepEqual(result.state?.sceneDirections,[]);assert.deepEqual(result.state?.visualPrompts,[]);assert.match(result.message||'',/realignment/i);
});

test('preserves a valid Phase 2 direction prefix for cross-profile resume',()=>{
  const transcriptScenes=[
    {number:1,start:0,end:8,duration:8,text:'First',silent:false},
    {number:2,start:8,end:16,duration:8,text:'Second',silent:false},
  ];
  const plans=[plan,{...plan,number:2,beat_id:'B02',alignment_claim:'Show the next assembly action'}];
  const firstDirection={...plan,start:0,end:8,duration:8,generation_duration_seconds:8,voiceover:'First',silent:false,subject:'Steel',product_visual_state:'Raw',primary_action:'Moves',supporting_motion:'None',environment_description:'Factory',camera:{shot_scale:'wide',lens:'35mm',angle:'eye',movement:'track',movement_speed:'slow'},lighting_and_material:'Cool steel',continuity_from_previous:'Opening',transition_to_next:'Cut',required_visible_features:['steel'],forbidden_elements:['finished product'],temporal_action};
  const raw:any={...initial,phase:2,topic:{topic:{title:'X'}},voiceoverTranscription:{duration:16,sceneDurationSeconds:8,text:'First Second',words:[],scenes:transcriptScenes},plannedScenes:plans,sceneDirections:[firstDirection]};
  const result=migrateProject(JSON.parse(JSON.stringify(raw)),initial,8);
  assert.equal(result.state?.phase,2);
  assert.equal(result.state?.plannedScenes.length,2);
  assert.equal(result.state?.sceneDirections.length,1);
  assert.equal(result.state?.sceneDirections[0].number,1);
  assert.match(result.message||'',/Resume from ALIGNED/i);
});

test('preserves a deferred repair queue across project export and opens Review',()=>{
  const transcriptScenes=[{number:1,start:0,end:8,duration:8,text:'First',silent:false}],generationSession=createProductionSession(transcriptScenes,[plan as any]);generationSession.status='deferred_repairs';generationSession.deferredRepairs=[{sceneNumber:1,operation:'DIRECTION',validationCode:'COMPONENT_PRESENT_TOO_EARLY',severity:'BLOCKING_ERROR',attempts:2,lastError:'mast appears before installation',dependencies:['STG_01.not_yet_installed']}];
  const raw:any={...initial,projectSchemaVersion:15,phase:3,topic:{topic:{title:'X'}},voiceoverTranscription:{duration:8,sceneDurationSeconds:8,text:'First',words:[],scenes:transcriptScenes},plannedScenes:[plan],generationSession};
  const result=migrateProject(JSON.parse(JSON.stringify(raw)),initial,8);assert.equal(result.state?.phase,3);assert.equal(result.state?.generationSession.status,'deferred_repairs');assert.equal(result.state?.generationSession.deferredRepairs[0]?.validationCode,'COMPONENT_PRESENT_TOO_EARLY');
});

test('migration clears a legacy false stage-environment repair and preserves completed paid output',()=>{
  const handoff:any=JSON.parse(JSON.stringify(template)),stage=handoff.production_stages[0],chapter=handoff.visual_story_plan.chapters[0],beat=chapter.visual_beats[0];
  const editorial={...handoff.environments[0],environment_id:'ENV_EDITORIAL_GENERIC',environment_name:'Generic technical editorial space',setting_scope:'GRAPHIC_SPACE',facility_claim_status:'GENERIC_NON_IDENTIFYING_VISUAL',exact_facility_name_if_verified:''};
  handoff.environments.push(editorial);chapter.applicable_production_stage_ids=[stage.stage_id];beat.applicable_stage_ids=[stage.stage_id];beat.environment_ids=[editorial.environment_id];beat.required_product_state_code=stage.product_state_code;beat.visual_family='TECHNICAL_GRAPHIC';beat.story_function='EXPLAIN_HIDDEN_SYSTEM';beat.product_visibility='NONE';beat.generation_permission='T2V_ALLOWED';beat.preferred_media_routes=['GENERATED_T2V'];
  const topic=normalizeProductionHandoff(handoff),scene={number:1,start:0,end:6,duration:6,text:'Explain the technical relationship.',silent:false};
  const planned=applyResolvedSceneContract(topic,{number:1,chapter_id:chapter.chapter_id,beat_id:beat.beat_id,contract_beat_id:beat.beat_id,visual_family:beat.visual_family,story_function:beat.story_function,visual_treatment:'MOTION_GRAPHIC_T2V',product_visibility:'NONE',stage_id:stage.stage_id,environment_ref:editorial.environment_id,state:stage.product_state_code,showdown_role:null,energy_level:'MEDIUM',camera_platform:null,graphic_spec:null,reference_asset_ids:[],required_visible_features:['one text-free technical relationship'],forbidden_elements:['readable generated text'],continuity_requirements:[],alignment_source:'ENGINE_BEAT',alignment_confidence:.99,alignment_claim:'Explain the technical relationship'} as any);
  const direction:any={...planned,...scene,generation_duration_seconds:6,voiceover:scene.text,subject:'Text-free technical relationship',product_visual_state:'Editorial technical view',primary_action:'One highlighted path reveals the relationship',supporting_motion:'One restrained light sweep',environment_description:'Generic technical editorial space',camera:{shot_scale:'MEDIUM',lens:'NORMAL',angle:'EYE_LEVEL',movement:'STATIC',movement_speed:'NONE'},lighting_and_material:'Neutral technical palette',continuity_from_previous:'Preserve the same relationship',transition_to_next:'Hold the final arrangement',temporal_action:{opening_state:'The components hold in a stable layout',primary_motion:'One path highlights progressively',physical_interaction:'The highlight connects the related components',mid_shot_progression:'The relationship becomes clear',ending_state:'The layout holds without text'}};
  const generationSession=createProductionSession([scene],[planned]);generationSession.status='deferred_repairs';generationSession.deferredRepairs=[{sceneNumber:1,operation:'DIRECTION',validationCode:'STAGE_ENVIRONMENT_MISMATCH',severity:'BLOCKING_ERROR',attempts:1,lastError:'Old stage-only validator rejected a valid beat environment',dependencies:['stage.environment_ids']}];generationSession.correctionPendingSceneNumbers=[1];
  const paidPrompt={number:1,action_description:'Existing action',video_prompt:'Existing paid prompt',voiceover:scene.text,stock_keywords:'technical'};
  const raw:any={...initial,projectSchemaVersion:16,phase:3,topic,voiceoverTranscription:{duration:6,sceneDurationSeconds:6,text:scene.text,words:[],scenes:[scene]},plannedScenes:[planned],sceneDirections:[direction],visualPrompts:[paidPrompt],generationSession};
  const result=migrateProject(JSON.parse(JSON.stringify(raw)),initial,6);
  assert.deepEqual(result.state?.generationSession.deferredRepairs,[]);
  assert.equal(result.state?.sceneDirections.length,1);
  assert.equal(result.state?.visualPrompts[0]?.video_prompt,'Existing paid prompt');
  assert.equal(result.state?.generationSession.status,'complete');
  assert.match(result.message||'',/without regeneration/i);
});

test('adopts schema 13 paid artifacts for cross-profile reuse without regeneration',()=>{
  const scene={...plan,start:0,end:8,duration:8,generation_duration_seconds:8,voiceover:'Hello',silent:false,subject:'Steel module',product_visual_state:'Incomplete State B',primary_action:'Tool seats the steel fastener',supporting_motion:'Fixture remains stable',environment_description:'Assembly bay',camera:{shot_scale:'MEDIUM',lens:'NORMAL',angle:'EYE_LEVEL',movement:'STATIC',movement_speed:'NONE'},lighting_and_material:'Neutral light',continuity_from_previous:'Opening',transition_to_next:'Hold',required_visible_features:['steel'],forbidden_elements:['finished product'],temporal_action};
  const raw:any={...initial,projectSchemaVersion:13,phase:3,topic:{topic:{title:'X'}},voiceoverTranscription:{duration:8,sceneDurationSeconds:8,text:'Hello',words:[],scenes:[{number:1,start:0,end:8,duration:8,text:'Hello',silent:false}]},plannedScenes:[plan],sceneDirections:[scene],visualPrompts:[{number:1,action_description:'Tool seats fastener',video_prompt:'8-second continuous shot. Steel module.',voiceover:'Hello',stock_keywords:'steel'}]};
  const result=migrateProject(raw,initial,8);assert.equal(result.state?.projectSchemaVersion,16);assert.equal(result.state?.sceneDirections[0].operationFingerprint,'legacy-preserved-v13');assert.equal(result.state?.visualPrompts[0].operationFingerprint,'legacy-preserved-v13');assert.equal(result.state?.visualPrompts[0].generationSource,'LEGACY');assert.equal(result.state?.generationSession.status,'complete');
});

test('imports a legacy VEO project without active profile state or repaying for compatible prompts',()=>{
  const scene={...plan,start:0,end:8,duration:8,generation_duration_seconds:8,voiceover:'Hello',silent:false,subject:'Steel module',product_visual_state:'Incomplete State B',primary_action:'Tool seats the steel fastener',supporting_motion:'Fixture remains stable',environment_description:'Assembly bay',camera:{shot_scale:'MEDIUM',lens:'NORMAL',angle:'EYE_LEVEL',movement:'STATIC',movement_speed:'NONE'},lighting_and_material:'Neutral light',continuity_from_previous:'Opening',transition_to_next:'Hold',required_visible_features:['steel'],forbidden_elements:['finished product'],temporal_action};
  const raw:any={...initial,projectSchemaVersion:14,t2vPromptProfile:'veo-flow',phase:3,topic:{topic:{title:'X'}},voiceoverTranscription:{duration:8,sceneDurationSeconds:8,text:'Hello',words:[],scenes:[{number:1,start:0,end:8,duration:8,text:'Hello',silent:false}]},plannedScenes:[plan],sceneDirections:[scene],visualPrompts:[{number:1,action_description:'Tool seats fastener',video_prompt:'Historical compatible prompt',voiceover:'Hello',stock_keywords:'steel',operationFingerprint:'old-veo-fingerprint'}]};
  const result=migrateProject(raw,initial,8);assert.equal(result.state?.phase,3);assert.equal(result.state?.visualPrompts[0].video_prompt,'Historical compatible prompt');assert.equal(result.state?.visualPrompts[0].operationFingerprint,'legacy-preserved-v13');assert.equal('t2vPromptProfile' in (result.state as any),false);assert.match(result.message||'',/future generation uses Omni Flash/i);
});

test('prefers an arbitrary positive V2 handoff duration over saved transcript timing', () => {
  const raw:any={topic:{_production_handoff:{schema:{version:'2.0.0'},visual_story_plan:{rhythm_policy:{preferred_usable_scene_duration_seconds:{preferred:6.5}}}}},voiceoverTranscription:{sceneDurationSeconds:10}};
  assert.equal(projectSceneDuration(raw, 8), 6.5);
});

test('clears legacy Phase 3 prompts and unplanned directions', () => {
  const scene = { number:1,start:0,end:8,duration:8,voiceover:'Hello',silent:false,stage_id:'S01',state:'A',subject:'Steel',product_visual_state:'Raw',primary_action:'Moves',supporting_motion:'None',environment_ref:'E01',environment_description:'Factory',camera:{shot_scale:'wide',lens:'35mm',angle:'eye',movement:'track',movement_speed:'slow'},lighting_and_material:'Steel',continuity_from_previous:'Opening',transition_to_next:'Cut',required_visible_features:['steel'],forbidden_elements:['finished'] };
  const raw:any = { ...initial, projectSchemaVersion:3, phase:3, topic:{topic:{title:'X'}}, voiceoverTranscription:{duration:8,sceneDurationSeconds:8,text:'Hello',words:[],scenes:[{number:1,start:0,end:8,duration:8,text:'Hello',silent:false}]}, sceneDirections:[scene], visualPrompts:[{number:1,video_prompt:'broken'}] };
  const result = migrateProject(raw, initial, 8);
  assert.equal(result.state?.phase, 2);
  assert.equal(result.state?.sceneDirections.length, 0);
  assert.deepEqual(result.state?.visualPrompts, []);
});

test('repairs blank immutable environment metadata from a stored scene plan',()=>{
  const scene={...plan,number:1,start:0,end:8,duration:8,voiceover:'Hello',silent:false,state:'A',subject:'Steel',product_visual_state:'Raw',primary_action:'Moves',supporting_motion:'None',environment_ref:'',environment_description:'Factory',camera:{shot_scale:'wide',lens:'35mm',angle:'eye',movement:'track',movement_speed:'slow'},lighting_and_material:'Steel',continuity_from_previous:'Opening',transition_to_next:'Cut',required_visible_features:['steel'],forbidden_elements:['finished'],temporal_action};
  const raw:any={...initial,phase:2,topic:{topic:{title:'X'}},plannedScenes:[plan],voiceoverTranscription:{duration:8,sceneDurationSeconds:8,text:'Hello',words:[],scenes:[{number:1,start:0,end:8,duration:8,text:'Hello',silent:false}]},sceneDirections:[scene]};
  const result=migrateProject(raw,initial,8);
  assert.equal(result.state?.sceneDirections[0]?.environment_ref,'E01');
  assert.equal(result.state?.sceneDirections[0]?.stage_id,'S01');
  assert.equal(result.state?.sceneDirections[0]?.state,'B');
});

test('preserves the complete V2 handoff through project JSON migration', () => {
  const topic = normalizeProductionHandoff(JSON.parse(JSON.stringify(template)));
  const exported = JSON.parse(JSON.stringify({ ...initial, topic, phase: 1 }));
  const result = migrateProject(exported, initial, 10);
  assert.deepEqual(result.state?.topic?._production_handoff, template);
  assert.deepEqual(result.state?.topic?._production_handoff?.visual_story_plan, template.visual_story_plan);
});

test('resets quota-driven schema 7 and 8 plans so they are rebuilt from the VO',()=>{
  const graphicPlan={...plan,visual_family:'TECHNICAL_GRAPHIC',visual_treatment:'MOTION_GRAPHIC_T2V',product_visibility:'NONE',graphic_spec:undefined};
  const scene={...graphicPlan,number:1,start:0,end:8,duration:8,voiceover:'Radar signals sweep across the detection field',silent:false,state:'B',subject:'Radar signal relationship',product_visual_state:'Conceptual technical diagram',primary_action:'One signal sweep crosses the field',supporting_motion:'One colored zone reveals the response',environment_description:'Abstract technical space',camera:{shot_scale:'wide',lens:'orthographic',angle:'top-down',movement:'static',movement_speed:'none'},lighting_and_material:'Flat vector palette',continuity_from_previous:'Opening',transition_to_next:'Hold',required_visible_features:['concentric signal field'],forbidden_elements:['readable text'],temporal_action};
  for(const projectSchemaVersion of [7,8]){
    const raw:any={...initial,projectSchemaVersion,phase:3,topic:{topic:{title:'Radar',category:'aircraft'}},plannedScenes:[graphicPlan],voiceoverTranscription:{duration:8,sceneDurationSeconds:8,text:scene.voiceover,words:[],scenes:[{number:1,start:0,end:8,duration:8,text:scene.voiceover,silent:false}]},sceneDirections:[scene],visualPrompts:[{number:1,video_prompt:'Old quota-driven prompt'}]};
    const result=migrateProject(raw,initial,8);
    assert.equal(result.state?.phase,2);
    assert.deepEqual(result.state?.plannedScenes,[]);
    assert.deepEqual(result.state?.sceneDirections,[]);
    assert.deepEqual(result.state?.visualPrompts,[]);
    assert.equal(result.state?.projectSchemaVersion,16);
  }
});
