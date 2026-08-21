import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFlowContext, compactIdentity, finalizeFlowPrompt, normalizeConstraintList, profileInstruction } from './flowPrompt';
import type { SceneDirection, TopicBrief } from '../types';

const direction = { number:1,start:0,end:10,duration:10,voiceover:'',silent:false,stage_id:'S01',state:'C',subject:'KJ-600',product_visual_state:'Complete',primary_action:'Taxis',supporting_motion:'Crew signals',environment_ref:'deck',environment_description:'Carrier deck',camera:{shot_scale:'medium-wide',lens:'35mm',angle:'low three-quarter',movement:'tracking',movement_speed:'slow'},lighting_and_material:'Daylight grey paint',continuity_from_previous:'None',transition_to_next:'Cut',required_visible_features:['rotodome'],forbidden_elements:['Jet engines','Weapons'] } satisfies SceneDirection;

const topic = { topic:{title:'KJ-600',category:'aircraft'},global_visual_constants:'',environments:[],visual_lock:'Compact high-wing twin-turboprop | circular dorsal rotodome | exactly four vertical tail surfaces',product_identity_lock:{core_geometry:'high wing and four-fin tail',surface_finish:'naval grey',markings:'restrained',scale_reference:'crew scale',distinctive_features:['two turboprops','rotodome'],must_remain_consistent_across_all_scenes:true},visual_exclusions:'Northrop Grumman E-2 Hawkeye, Jet engines',negative_prompt_global:['Weapons','Readable text'] } as TopicBrief;

test('uses generation duration instead of a partial transcript-window duration', () => {
  const result=finalizeFlowPrompt('A camera tracks the aircraft.',{...direction,duration:1.25,generation_duration_seconds:6},topic,'veo-flow');
  assert.match(result,/^6-second continuous shot\./);
});

test('normalizes nested constraints without spreading strings into characters', () => assert.deepEqual(normalizeConstraintList(['Jet engines',['Weapons','jet engines'],'Northrop Grumman E-2']), ['Jet engines','Weapons','Northrop Grumman E-2']));
test('serializes identity objects without object coercion', () => assert.doesNotMatch(compactIdentity(topic), /\[object Object\]/));
test('produces a compact clean Flow prompt with one duration and deduplicated guards', () => {
  const result = finalizeFlowPrompt('Exact 10.000-second shot. A completed aircraft taxis while a camera tracks beside it. Visual Lock verbatim: duplicated junk.', direction, topic, 'omni-flash');
  assert.doesNotMatch(result, /\[object Object\]|N, o, r, t, h/);
  assert.equal((result.match(/10-second continuous shot/gi)||[]).length, 1);
  assert.equal((result.match(/Jet engines/gi)||[]).length, 1);
  assert.ok(result.split(/\s+/).length <= 160);
  assert.match(result, /ambient sound\. Exclude dialogue, narration, music/);
});
test('profile instructions are materially different', () => assert.notEqual(profileInstruction('omni-flash'), profileInstruction('veo-flow')));
test('Veo uses descriptive negative-prompt grammar instead of no/don’t commands', () => {
  const result = finalizeFlowPrompt('A camera tracks the aircraft across the deck.', direction, topic, 'veo-flow');
  assert.match(result, /Negative prompt: Jet engines, Weapons/);
  assert.doesNotMatch(result, /Negative prompt: (?:No|Avoid|Do not)/i);
});
test('Omni receives only batch-relevant handoff records while Veo remains unchanged',()=>{
  const handoff={schema:{name:'Handoff'},product:{official_name:'KJ-600'},dimensions_and_proportions:{overall_length:30},global_prompt_rules:{one_primary_action:true},production_stages:[{stage_id:'S01',environment_id:'E1',geometry_control:{primary_geometry_module_id:'M1'},visual_evidence:{reference_asset_ids:['R1']}},{stage_id:'S99',environment_id:'E99',geometry_control:{primary_geometry_module_id:'M99'},visual_evidence:{reference_asset_ids:['R99']}}],environments:[{environment_id:'E1'},{environment_id:'E99'}],geometry_modules:[{module_id:'M1'},{module_id:'M99'}],reference_assets:[{asset_id:'R1',identity:'KJ-600',configuration:'carrier AEW',production_state:'complete',viewpoint:'rear',visible_geometry_features:['four-fin tail'],allowed_usage:['identity'],forbidden_usage:['internal layout'],facility_status:'unassigned',confidence:'HIGH'},{asset_id:'R99',identity:'unrelated'}],stage_transitions:[{from_stage_id:'S00',to_stage_id:'S01'},{from_stage_id:'S01',to_stage_id:'S02'},{from_stage_id:'S98',to_stage_id:'S99'}]};
  const scopedTopic={...topic,_production_handoff:handoff} as any;
  const omni:any=buildFlowContext(scopedTopic,[direction],'omni-flash');
  assert.deepEqual(omni.authoritative_production_handoff.production_stages.map((item:any)=>item.stage_id),['S01']);
  assert.deepEqual(omni.authoritative_production_handoff.environments.map((item:any)=>item.environment_id),['E1']);
  assert.deepEqual(omni.authoritative_production_handoff.geometry_modules.map((item:any)=>item.module_id),['M1']);
  assert.deepEqual(omni.authoritative_production_handoff.reference_assets.map((item:any)=>item.asset_id),['R1']);
  assert.deepEqual(omni.authoritative_production_handoff.reference_assets[0],handoff.reference_assets[0]);
  assert.equal(omni.authoritative_production_handoff.stage_transitions.length,2);
  assert.equal(omni.authoritative_production_handoff.product.official_name,'KJ-600');
  assert.equal('authoritative_production_handoff' in buildFlowContext(scopedTopic,[direction],'veo-flow'),false);
});

test('Veo compiles graphic treatments without finished identity or factory ambience',()=>{
  const graphic={...direction,visual_treatment:'MOTION_GRAPHIC_T2V' as const,product_visibility:'NONE' as const,graphic_spec:{graphic_subtype:'SENSOR_SIGNAL' as const,visual_claim:'Show one radar signal sweeping toward one stable aircraft silhouette',composition:'CONCENTRIC_SIGNAL_FIELD' as const,motion_pattern:'SIGNAL_SWEEP' as const,annotation_devices:['SIGNAL_WAVES' as const,'COLORED_ZONE' as const],palette_profile:'PREMIUM_TECHNICAL_VECTOR' as const,maximum_animated_elements:2 as const,transition_anchor:null,text_policy:'NO_GENERATED_TEXT' as const},temporal_action:{opening_state:'Three shapes are separated',primary_motion:'One path connects the shapes',physical_interaction:'The path meets each edge',mid_shot_progression:'The relationship resolves',ending_state:'The composition settles'}};
  const result=finalizeFlowPrompt('ignored',graphic,topic,'veo-flow');
  assert.match(result,/premium 16:9 flat 2D vector technical explainer/i);assert.match(result,/concentric signal field/i);assert.match(result,/final quarter as a steady comprehension hold/i);
  assert.doesNotMatch(result,/Maintain this finished-product identity|ambient production sound|reserve (?:a )?blank label|add (?:the )?text later|editor-added typography/i);
  assert.match(result,/generated words or numbers/i);assert.equal((result.match(/10-second continuous shot/gi)||[]).length,1);
});

test('Veo operational prompts include aircraft motion safeguards and synchronized sound',()=>{
  const operational={...direction,visual_family:'DYNAMIC_TESTING' as const,visual_treatment:'LIVE_ACTION_T2V' as const,product_visibility:'FULL' as const,primary_action:'The fighter aircraft performs a controlled banked transit',showdown_role:'SECOND_PEAK' as const,energy_level:'HIGH' as const,camera_platform:'CHASE_AIRCRAFT' as const};
  const localTopic={...topic,_production_handoff:{product:{product_class:'fighter aircraft'}}} as any;
  const result=finalizeFlowPrompt('The aircraft enters a smooth bank while a long-lens camera tracks from the ground.',operational,localTopic,'veo-flow');
  assert.match(result,/propulsion, airflow, wind, and control-surface sound/i);assert.match(result,/weapon discharge/i);assert.match(result,/impossible aerobatics/i);
  assert.match(result,/physically credible chase aircraft/i);assert.match(result,/stable geometry and a settled ending/i);assert.match(result,/camera passing through the aircraft/i);
});
