import assert from 'node:assert/strict';
import test from 'node:test';
import type { PlannedScene, SceneDirection, TimedScene, TopicBrief } from '../types';
import { partitionDirectionResponse } from './productionApi';
import { semanticDirectionFindings, stageChronologyFindings, structuredDirectionFindings, structuredPlanFindings } from './validationModel';

const scene:TimedScene={number:1,start:0,end:6,duration:6,text:'The complete test article receives its final static inspection.',silent:false};
const plan=(overrides:Partial<PlannedScene>={}):PlannedScene=>({number:1,chapter_id:'CH01',beat_id:'BEAT_TEST',visual_family:'ASSEMBLY_PROCESS',story_function:'EXPLAIN_PROCESS',visual_treatment:'LIVE_ACTION_T2V',product_visibility:'FULL',stage_id:'STG_TEST',environment_ref:'ENV_TEST',state:'B',showdown_role:null,energy_level:'MEDIUM',camera_platform:null,graphic_spec:null,reference_asset_ids:[],required_visible_features:['complete test article'],forbidden_elements:['sensor mast'],continuity_requirements:[],alignment_source:'ENGINE_BEAT',alignment_confidence:.95,alignment_claim:'A complete test article receives its final static inspection',...overrides});
const creative=(overrides:Record<string,unknown>={})=>({number:1,subject:'Complete test article',product_visual_state:'Complete test article in structured State B',primary_action:'An inspector performs a final static inspection of the complete test article',supporting_motion:'The test fixture remains stationary',environment_description:'Documented test bay',camera:{shot_scale:'MEDIUM',lens:'NORMAL',angle:'EYE_LEVEL',movement:'STATIC',movement_speed:'NONE'},lighting_and_material:'Neutral inspection light',continuity_from_previous:'Preserve the test configuration',transition_to_next:'Hold on the inspected article',required_visible_features:['complete test article'],forbidden_elements:['sensor mast'],temporal_action:{opening_state:'The complete test article rests in its test fixture',primary_motion:'The inspector moves one gauge toward the article',physical_interaction:'The gauge contacts one inspection point',mid_shot_progression:'The inspector completes the static check',ending_state:'The complete test article remains stationary after inspection'},...overrides});
const direction=(planned=plan(),overrides:Record<string,unknown>={}):SceneDirection=>({...planned,...scene,voiceover:scene.text,generation_duration_seconds:6,...creative(overrides)} as SceneDirection);

const handoff:any={
  schema:{version:'2.0.0'},
  product:{official_name:'Test craft',exact_variant:'Test craft B',visually_similar_products_to_avoid:['Wrong craft']},
  environments:[{environment_id:'ENV_TEST',exact_facility_name_if_verified:''}],
  production_stages:[
    {stage_id:'STG_EARLY',stage_number:1,product_state_code:'A',environment_ids:['ENV_TEST'],not_yet_installed:['sensor mast'],geometry_control:{forbidden_transformations:[],negative_constraints:[]}},
    {stage_id:'STG_TEST',stage_number:2,product_state_code:'B',environment_ids:['ENV_TEST'],not_yet_installed:[],geometry_control:{forbidden_transformations:[],negative_constraints:[]}},
    {stage_id:'STG_LATE',stage_number:6,product_state_code:'C',environment_ids:['ENV_TEST'],not_yet_installed:[],geometry_control:{forbidden_transformations:[],negative_constraints:[]}},
  ],
  visual_story_plan:{chapters:[{visual_beats:[
    {beat_id:'BEAT_EARLY',generation_permission:'T2V_ALLOWED',preferred_media_routes:['GENERATED_T2V'],applicable_stage_ids:['STG_EARLY'],required_product_state_code:'A',environment_ids:['ENV_TEST'],must_not_show:['sensor mast'],exact_factory_claim_allowed:false},
    {beat_id:'BEAT_TEST',generation_permission:'T2V_ALLOWED',preferred_media_routes:['GENERATED_T2V'],applicable_stage_ids:['STG_TEST'],required_product_state_code:'B',environment_ids:['ENV_TEST'],must_not_show:[],exact_factory_claim_allowed:false},
    {beat_id:'BEAT_LATE',generation_permission:'T2V_ALLOWED',preferred_media_routes:['GENERATED_T2V'],applicable_stage_ids:['STG_LATE'],required_product_state_code:'C',environment_ids:['ENV_TEST'],must_not_show:[],exact_factory_claim_allowed:false},
    {beat_id:'BEAT_REFERENCE',generation_permission:'REFERENCE_ONLY',preferred_media_routes:['REFERENCE_IMAGE'],applicable_stage_ids:['STG_TEST'],required_product_state_code:'B',environment_ids:['ENV_TEST'],must_not_show:[],exact_factory_claim_allowed:false},
  ]}]},
};
const topic={_production_handoff:handoff} as unknown as TopicBrief;

test('a complete test article remains valid in authoritative State B',()=>{
  const planned=plan(),value=direction(planned);
  assert.deepEqual(structuredPlanFindings(topic,planned),[]);
  assert.equal(structuredDirectionFindings(topic,value,scene,planned,6).some(item=>item.severity==='BLOCKING_ERROR'),false);
  assert.equal(semanticDirectionFindings(value).some(item=>item.code==='LIFECYCLE_CONTRADICTION'),false);
});

test('a later-stage opening preview may transition to earlier manufacturing without a chronology defect',()=>{
  const opening=plan({number:1,beat_id:'BEAT_LATE',stage_id:'STG_LATE',state:'C',story_function:'OPENING_HOOK'}),manufacturing=plan({number:2,beat_id:'BEAT_EARLY',stage_id:'STG_EARLY',state:'A',story_function:'EXPLAIN_PROCESS'});
  assert.deepEqual(stageChronologyFindings([opening,manufacturing],topic),[]);
  assert.equal(stageChronologyFindings([{...opening,story_function:'EXPLAIN_PROCESS'},manufacturing],topic)[0]?.code,'SEQUENTIAL_STAGE_REGRESSION');
});

test('an explicitly early component is a machine-readable structured blocker',()=>{
  const planned=plan({beat_id:'BEAT_EARLY',stage_id:'STG_EARLY',state:'A',required_visible_features:[]}),value=direction(planned,{subject:'Unfinished hull with sensor mast installed',primary_action:'A worker checks the sensor mast'}),finding=structuredDirectionFindings(topic,value,scene,planned,6).find(item=>item.code==='COMPONENT_PRESENT_TOO_EARLY');
  assert.equal(finding?.severity,'BLOCKING_ERROR');assert.equal(finding?.structuredRuleSource,'STG_EARLY.not_yet_installed');assert.equal(finding?.expected,'sensor mast absent');
});

test('a forbidden media route remains a strict concrete blocker',()=>{
  const findings=structuredPlanFindings(topic,plan({beat_id:'BEAT_REFERENCE'}));assert.equal(findings.find(item=>item.code==='GENERATION_ROUTE_FORBIDDEN')?.severity,'BLOCKING_ERROR');
});

test('wrong stage and unknown environment references remain strict concrete blockers',()=>{
  const findings=structuredPlanFindings(topic,plan({beat_id:'BEAT_EARLY',environment_ref:'ENV_UNKNOWN'}));assert.equal(findings.find(item=>item.code==='BEAT_STAGE_MISMATCH')?.severity,'BLOCKING_ERROR');assert.equal(findings.find(item=>item.code==='UNKNOWN_ENVIRONMENT_ID')?.structuredRuleSource,'environments');
});

test('an ambiguous semantic concern gets one repair then becomes a warning instead of a credit loop',()=>{
  const planned=plan({alignment_claim:'A crane lifts a red turbine over a mountain plateau'}),raw=[creative({subject:'Inspector and complete test article',primary_action:'The inspector checks one static surface'})],fingerprints=new Map([[1,'fingerprint']]);
  const first=partitionDirectionResponse(raw,[scene],[planned],6,fingerprints),afterRepair=partitionDirectionResponse(raw,[scene],[planned],6,fingerprints,{afterRepair:true});
  assert.equal(first.failed[0]?.severity,'REPAIRABLE_ERROR');assert.equal(first.accepted.length,0);
  assert.equal(afterRepair.failed.length,0);assert.equal(afterRepair.accepted.length,1);assert.equal(afterRepair.warnings[0]?.severity,'WARNING');
});
