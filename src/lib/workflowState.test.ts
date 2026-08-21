import assert from 'node:assert/strict';
import test from 'node:test';
import type { AppState, SceneDirection, T2VPrompt } from '../types';
import template from '../schemas/Modus_Visual_Production_Handoff_V2_Template.json';
import { normalizeProductionHandoff } from './productionTemplate';
import { createResumableProductionSession, createProductionSession } from './productionSession';
import { idleGenerationSession } from './generationSession';
import { validateProductionReadiness } from './setupValidation';
import { lastDurableProductionPoint, pendingProductionPoint, prepareSceneRepair, projectWorkflowStage } from './workflowState';

const scenes=[{number:1,start:0,end:6,duration:6,text:'First scene',silent:false},{number:2,start:6,end:12,duration:6,text:'Second scene',silent:false}];
const topic=normalizeProductionHandoff(JSON.parse(JSON.stringify(template)));
const transcript={audioFileName:'voice.json',duration:12,language:'en' as const,languageProbability:1,model:'external',computeType:'external',text:'First scene Second scene',segments:[],words:[],sceneDurationSeconds:6,scenes,importedAt:'now'};
const base=():AppState=>({projectSchemaVersion:15,projectName:'Workflow',projectFormat:'standard-lifecycle',phase:1,topic,plannedScenes:[],sceneDirections:[],masterVoiceoverScript:transcript.text,voiceoverTranscription:transcript,visualPrompts:[],generationSession:idleGenerationSession()});
const direction=(number:number)=>({number,start:(number-1)*6,end:number*6,duration:6,generation_duration_seconds:6,voiceover:scenes[number-1].text,silent:false,stage_id:'STG_01',state:'A',subject:'Material',product_visual_state:'State A',primary_action:'Material moves',supporting_motion:'Fixture holds',environment_ref:'ENV_01',environment_description:'Factory',camera:{shot_scale:'MEDIUM',lens:'NORMAL',angle:'EYE_LEVEL',movement:'STATIC',movement_speed:'NONE'},lighting_and_material:'Neutral',continuity_from_previous:'Continue',transition_to_next:'Cut',required_visible_features:['material'],forbidden_elements:['finished product']} as SceneDirection);
const prompt=(number:number)=>({number,action_description:'Material moves',video_prompt:'Omni prompt',voiceover:scenes[number-1].text,stock_keywords:'material'} as T2VPrompt);

test('Setup becomes ready only with both validated inputs',()=>{const state=base();assert.equal(validateProductionReadiness({...state,voiceoverTranscription:null}).ready,false);assert.equal(validateProductionReadiness(state).ready,true);assert.equal(projectWorkflowStage(state),1);});
test('an interrupted durable project opens in Production',()=>{const state=base(),session=createProductionSession(scenes,[]);assert.equal(projectWorkflowStage({...state,phase:2,plannedScenes:[{number:1} as any],generationSession:{...session,status:'interrupted'}}),2);});
test('a completed durable project opens in Review & Export',()=>{const state=base(),directions=scenes.map((_,index)=>direction(index+1)),prompts=scenes.map((_,index)=>prompt(index+1)),session=createResumableProductionSession(scenes,[],directions,prompts);assert.equal(projectWorkflowStage({...state,phase:2,sceneDirections:directions,visualPrompts:prompts,generationSession:{...session,status:'complete'}}),3);});
test('quota recovery describes the last saved and exact pending operation',()=>{const state=base(),directions=[direction(1),direction(2)],prompts=[prompt(1)],session=createResumableProductionSession(scenes,[],directions,prompts),paused={...state,phase:2 as const,sceneDirections:directions,visualPrompts:prompts,generationSession:{...session,status:'paused' as const,pauseReason:'quota' as const,operation:'GENERATING_PROMPTS' as const}};assert.equal(lastDurableProductionPoint(paused),'Scene 1 · Prompt generated');assert.match(pendingProductionPoint(paused),/Scene 2 · generating prompts/i);});
test('selective prompt repair preserves every direction and unrelated prompt',()=>{const state=base(),directions=[direction(1),direction(2)],prompts=[prompt(1),prompt(2)],next=prepareSceneRepair({...state,sceneDirections:directions,visualPrompts:prompts},2,'prompt');assert.deepEqual(next.sceneDirections.map(item=>item.number),[1,2]);assert.deepEqual(next.visualPrompts.map(item=>item.number),[1]);assert.equal(next.phase,2);});
