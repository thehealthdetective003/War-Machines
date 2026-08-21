import assert from 'node:assert/strict';
import test from 'node:test';
import type { AppState, PlannedScene, SceneDirection, TimedScene, T2VPrompt } from '../types';
import { directionOperationFingerprint, partitionAlignmentResponse, partitionDirectionResponse, partitionReusableDirections } from './productionApi';
import type { AlignmentRequestGroup } from './visualAlignment';
import { compileLocalGraphicPrompt, partitionReusablePrompts, promptOperationFingerprint, requestPromptAttempt } from './productionPrompt';
import { composeDirectionInstruction, composeOmniPromptInstruction } from './productionInstructions';
import { getApiUsageDiagnostics, resetApiUsageDiagnostics } from './apiDiagnostics';
import { replaceDirectionAndInvalidatePrompt } from './productionSession';
import { idleGenerationSession } from './generationSession';

const timed=(number:number):TimedScene=>({number,start:(number-1)*6,end:number*6,duration:6,text:`A tool seats fastener ${number} on the steel module.`,silent:false});
const plan=(number:number):PlannedScene=>({number,chapter_id:'CH01',beat_id:`B${number}`,visual_family:'ASSEMBLY_PROCESS',story_function:'EXPLAIN_PROCESS',visual_treatment:'LIVE_ACTION_T2V',product_visibility:'PARTIAL',stage_id:'S01',environment_ref:'E01',state:'B',showdown_role:null,energy_level:'MEDIUM',camera_platform:null,graphic_spec:null,reference_asset_ids:[],required_visible_features:['steel module'],forbidden_elements:['finished product'],continuity_requirements:['preserve the fixture'],alignment_source:'ENGINE_BEAT',alignment_confidence:.9,alignment_claim:`tool seats fastener ${number} on the steel module`});
const generatedDirection=(number:number)=>({number,subject:`steel module fastener ${number}`,product_visual_state:'Incomplete State B steel module',primary_action:`The tool seats fastener ${number} on the steel module`,supporting_motion:'The fixture remains stable',environment_description:'Documented assembly bay',camera:{shot_scale:'MEDIUM',lens:'NORMAL',angle:'EYE_LEVEL',movement:'STATIC',movement_speed:'NONE'},lighting_and_material:'Neutral factory light on steel',continuity_from_previous:'Preserve the fixture',transition_to_next:'Hold on the seated fastener',required_visible_features:['steel module'],forbidden_elements:['finished product'],temporal_action:{opening_state:'The steel module rests in its fixture',primary_motion:`The tool approaches fastener ${number}`,physical_interaction:`The tool seats fastener ${number}`,mid_shot_progression:'The fastener settles progressively into the steel module',ending_state:'The tool withdraws from the secured steel module'}});
const direction=(number:number):SceneDirection=>({...plan(number),...timed(number),voiceover:timed(number).text,generation_duration_seconds:6,...generatedDirection(number)} as SceneDirection);
const prompt=(number:number,fingerprint?:string):T2VPrompt=>({number,action_description:`Seat fastener ${number}`,video_prompt:'6-second continuous shot. A locked camera watches one tool seat a fastener on a steel module. Generate synchronized ambient sound. Exclude dialogue, narration, music, and readable generated text.',voiceover:timed(number).text,stock_keywords:'steel, module, fastener',operationFingerprint:fingerprint,generationSource:'API'});

test('partially accepts nine valid direction items and isolates one malformed scene',()=>{
  const scenes=Array.from({length:10},(_,index)=>timed(index+1)),plans=Array.from({length:10},(_,index)=>plan(index+1)),raw=Array.from({length:10},(_,index)=>index===9?{number:10}:{...generatedDirection(index+1)}),fingerprints=new Map(scenes.map(scene=>[scene.number,`direction:test:${scene.number}`]));
  const result=partitionDirectionResponse(raw,scenes,plans,6,fingerprints);
  assert.equal(result.accepted.length,9);assert.deepEqual(result.failed.map(item=>item.number),[10]);assert.equal(result.accepted[0].operationFingerprint,'direction:test:1');
});

test('partially accepts valid semantic groups and reports only the omitted group',()=>{
  const requests:AlignmentRequestGroup[]=Array.from({length:3},(_,index)=>({group_id:`VG_${index+1}`,scene_numbers:[index+1],voiceover:`Fastener ${index+1}`,previous_context:'',next_context:'',candidates:[{beat_id:`B${index+1}`,beat_name:'Assembly',narrative_purpose:'Show fastening',story_function:'EXPLAIN_PROCESS',visual_family:'ASSEMBLY_PROCESS',semantic_alignment_terms:['fastener'],stage_ids:['S01'],environment_ids:['E01'],product_visibility:'PARTIAL',must_show:['steel module'],must_not_show:['finished product']}]}));
  const raw=requests.slice(0,2).map(request=>({group_id:request.group_id,source:'ENGINE_BEAT',beat_id:request.candidates[0].beat_id,confidence:.9,visual_claim:`Show ${request.voiceover}`,graphic_required:false,graphic_scene_numbers:[]})),fingerprints=new Map(requests.map(request=>[request.group_id,`alignment:${request.group_id}`]));
  const result=partitionAlignmentResponse(requests,raw,fingerprints);assert.equal(result.accepted.length,2);assert.deepEqual(result.failed.map(item=>item.id),['VG_3']);
});

test('prompt partial acceptance persists nine results and retries only the failed scene',async()=>{
  resetApiUsageDiagnostics();const directions=Array.from({length:10},(_,index)=>({...direction(index+1),product_visibility:'NONE' as const,required_visible_features:[]}));
  const calls:any[]=[];const ai={models:{generateContent:async(request:any)=>{calls.push(JSON.parse(request.contents));const requested=JSON.parse(request.contents).prompt_context.scenes as SceneDirection[];const items=requested.filter(item=>calls.length>1||item.number!==10).map(item=>({number:item.number,video_prompt:`A locked documentary camera watches one tool seat fastener ${item.number} on the steel module with progressive physical contact and a settled ending.`}));return {text:JSON.stringify(items)};}}};
  const first=await requestPromptAttempt(ai,'gemini-test',{topic:null,t2vPromptProfile:'veo-flow'},directions);assert.equal(first.accepted.length,9);assert.deepEqual(first.failed.map(item=>item.number),[10]);
  const firstPrompt=first.accepted[0].video_prompt,retry=await requestPromptAttempt(ai,'gemini-test',{topic:null,t2vPromptProfile:'veo-flow'},[directions[9]],first.reason||undefined);assert.equal(retry.accepted.length,1);assert.equal(calls[1].prompt_context.scenes.length,1);assert.equal(calls[1].prompt_context.scenes[0].number,10);assert.equal(first.accepted[0].video_prompt,firstPrompt);
  const diagnostics=getApiUsageDiagnostics();assert.equal(diagnostics.totalApiCalls,2);assert.equal(diagnostics.promptApiCalls,2);assert.equal(diagnostics.correctionApiCalls,1);assert.equal(diagnostics.totalRequestedItems,11);assert.ok(diagnostics.fullBatchRetriesAvoided>=1);assert.ok(diagnostics.unusedGeneratedFieldsRemoved>0);
});

test('compiles an approved technical graphic locally without any API request or allocation change',async()=>{
  resetApiUsageDiagnostics();const graphic={...direction(1),visual_family:'TECHNICAL_GRAPHIC' as const,visual_treatment:'MOTION_GRAPHIC_T2V' as const,product_visibility:'NONE' as const,required_visible_features:['one text-free fastening relationship'],graphic_spec:{graphic_subtype:'MECHANICAL_RELATIONSHIP' as const,visual_claim:'Show one fastener seating into one steel module',composition:'ORTHOGRAPHIC_CUTAWAY' as const,motion_pattern:'COMPONENT_TRANSLATION' as const,annotation_devices:['DIRECTIONAL_ARROWS' as const],palette_profile:'PREMIUM_TECHNICAL_VECTOR' as const,maximum_animated_elements:1 as const,transition_anchor:null,text_policy:'NO_GENERATED_TEXT' as const}};
  let calls=0;const ai={models:{generateContent:async()=>{calls++;throw new Error('API must not be called');}}};const result=await requestPromptAttempt(ai,'gemini-test',{topic:null,t2vPromptProfile:'omni-flash'},[graphic]);
  assert.equal(calls,0);assert.equal(result.accepted.length,1);assert.equal(result.accepted[0].generationSource,'LOCAL_GRAPHIC');assert.match(result.accepted[0].video_prompt,/fastener seating into one steel module/i);assert.equal(graphic.visual_family,'TECHNICAL_GRAPHIC');assert.equal(getApiUsageDiagnostics().locallyCompiledGraphicPrompts,1);
  assert.ok(compileLocalGraphicPrompt({topic:null,t2vPromptProfile:'veo-flow'},graphic).prompt);
});

test('reuses an unchanged prompt fingerprint and marks only a changed direction stale',()=>{
  const original=direction(1),state={topic:null,t2vPromptProfile:'veo-flow' as const},fingerprint=promptOperationFingerprint(state,'gemini-test',original),stored=prompt(1,fingerprint);
  const unchanged=partitionReusablePrompts([stored],[original],state,'gemini-test');assert.equal(unchanged.reusable.length,1);assert.deepEqual(unchanged.staleSceneNumbers,[]);
  const changed={...original,primary_action:'The tool removes the fastener from the steel module'};const updated=partitionReusablePrompts([stored],[changed],state,'gemini-test');assert.equal(updated.reusable.length,0);assert.deepEqual(updated.staleSceneNumbers,[1]);
});

test('resume reuses completed directions and requests only the unfinished scene',()=>{
  const scenes=[timed(1),timed(2)],plans=[plan(1),plan(2)],state={topic:null},first={...direction(1),operationFingerprint:directionOperationFingerprint(state,'gemini-test',scenes[0],plans[0],null)};
  const result=partitionReusableDirections([first],scenes,plans,state,'gemini-test',null);assert.deepEqual(result.reusable.map(item=>item.number),[1]);assert.deepEqual(result.missingScenes.map(item=>item.number),[2]);assert.deepEqual(result.staleSceneNumbers,[]);
});

test('changing one direction invalidates only its dependent prompt',()=>{
  const directions=[direction(1),direction(2)],prompts=[prompt(1),prompt(2)],state={projectSchemaVersion:14,projectName:'Test',projectFormat:'standard-lifecycle',phase:3,topic:null,plannedScenes:[plan(1),plan(2)],sceneDirections:directions,masterVoiceoverScript:'',voiceoverTranscription:{scenes:[timed(1),timed(2)]},t2vPromptProfile:'veo-flow',visualPrompts:prompts,demoState:'idle',demoScenes:[],demoSceneNumbers:[],generationSession:idleGenerationSession()} as unknown as AppState;
  const next=replaceDirectionAndInvalidatePrompt(state,{...directions[0],primary_action:'A revised fastening action'});assert.deepEqual(next.visualPrompts.map(item=>item.number),[2]);assert.equal(next.sceneDirections.find(item=>item.number===1)?.primary_action,'A revised fastening action');
});

test('specialized instruction modules appear only when applicable',()=>{
  const ordinary=direction(1),ordinaryDirection=composeDirectionInstruction([ordinary]),ordinaryPrompt=composeOmniPromptInstruction([ordinary]);assert.doesNotMatch(ordinaryDirection,/Aviation roles|aerodynamically/i);assert.doesNotMatch(ordinaryPrompt,/aviation footage|aerodynamically/i);assert.doesNotMatch(ordinaryPrompt,/technical graphic|vector/i);
  const aviation={...ordinary,visual_family:'DYNAMIC_TESTING' as const,showdown_role:'PERFORMANCE_PASS' as const,camera_platform:'CHASE_AIRCRAFT' as const};assert.match(composeDirectionInstruction([aviation],'fighter aircraft'),/Aviation roles/i);assert.match(composeOmniPromptInstruction([aviation],'fighter aircraft'),/aviation footage/i);
});
