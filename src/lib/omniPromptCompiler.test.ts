import assert from 'node:assert/strict';
import test from 'node:test';
import type { SceneDirection, TopicBrief } from '../types';
import { canonicalIdentitySignature, compileOmniPrompt, normalizeOmniSections, recompileOmniPrompts, resolveProductionScene } from './omniPromptCompiler';
import { MAX_VIDEO_PROMPT_WORDS, countPromptWords } from './promptLimits';

const direction:SceneDirection={number:1,start:0,end:10,duration:10,voiceover:'',silent:false,stage_id:'S02',state:'B',subject:'Incomplete KJ-600 airframe',product_visual_state:'Structurally joined airframe',primary_action:'A technician checks the exposed wing-fold hinge',supporting_motion:'A metrology light sweeps slowly',environment_ref:'E01',environment_description:'Bright aircraft assembly hall',camera:{shot_scale:'medium-wide',lens:'short telephoto',angle:'rear three-quarter',movement:'slow lateral dolly',movement_speed:'slow'},lighting_and_material:'Realistic industrial light on bare metal',continuity_from_previous:'Fuselage joined',transition_to_next:'Engine integration',required_visible_features:['broad horizontal stabilizer','exactly four vertical fins'],forbidden_elements:['engines','rotodome','final paint']};
const handoff={product:{official_name:'KJ-600',exact_variant:'carrier AEW',immutable_identity_features:['compact fuselage','high-mounted wing','exactly two engine nacelles','large circular rotodome','broad horizontal stabilizer','exactly four vertical fins','tricycle landing gear']},geometry_modules:[{module_id:'AIRFRAME',required_visible_features:['broad horizontal stabilizer','exactly four vertical fins','arresting-hook region'],forbidden_geometry_changes:['changing fin count']}],environments:[{environment_id:'E01',facility_type:'assembly hall',forbidden_elements:['passenger windows']}],reference_assets:[{asset_id:'R1',confidence:'HIGH'}],production_stages:[{stage_id:'S02',environment_id:'E01',present_now:['fuselage','centre wing','tail'],not_yet_installed:['engines','rotodome','landing gear','final paint'],temporarily_exposed:['wing-fold interface'],geometry_control:{primary_geometry_module_id:'AIRFRAME',required_visible_anchors:['four-fin tail'],negative_constraints:['generic airliner geometry'],forbidden_transformations:['automatic panel closure']},stage_actions:[{forbidden_actions:['engine operation']}],camera_guidance:{},visual_evidence:{confirmed_visual_details:['joined fuselage'],analyst_inferred_visual_details:['tool placement'],reference_asset_ids:['R1']},continuity:{}}],stage_transitions:[{from_stage_id:'S02',to_stage_id:'S03',components_added:['engines']}]};
const topic={topic:{title:'KJ-600 production',product:'KJ-600',category:'aircraft'},global_visual_constants:'',environments:[],_production_handoff:handoff} as unknown as TopicBrief;

test('compiles complete natural prose with one duration and explicit incomplete state',()=>{const {sections}=normalizeOmniSections({cinematography:'medium-wide rear three-quarter view and',subject:'incomplete KJ-600 airframe',action:'a technician checks the hinge',environment:'bright assembly hall',style_lighting:'restrained documentary light',product_state:'ignored malformed state',sound:'factory hum',exclusions:['engines','','engines']},direction,topic);const prompt=compileOmniPrompt(sections,direction);assert.equal((prompt.match(/10-second continuous shot/gi)||[]).length,1);assert.doesNotMatch(prompt,/\[object Object\]|undefined|prompt_sections| and\./i);assert.match(prompt,/Do not show engines, rotodome, landing gear, and final paint/i);assert.equal((prompt.match(/Exclude dialogue, narration, music/gi)||[]).length,1);});
test('uses full generation duration when the final transcript window is shorter',()=>{const fixture={...direction,duration:1.25,generation_duration_seconds:6};const prompt=compileOmniPrompt(normalizeOmniSections({},fixture,topic).sections,fixture);assert.match(prompt,/^6-second continuous shot\./);assert.doesNotMatch(prompt,/1\.25-second continuous shot/);});
test('selects rear-view geometry and preserves exact counts',()=>{const resolved=resolveProductionScene(topic,direction);assert.ok(resolved.identity.some(value=>/exactly four vertical fins/i.test(value)));assert.ok(resolved.identity.some(value=>/stabilizer/i.test(value)));assert.ok(!resolved.identity.some(value=>/compact fuselage/i.test(value)));});
test('compiles structural, mechanical-test, and operational scene fixtures',()=>{const fixtures=[direction,{...direction,number:2,primary_action:'The outer wing panel rotates slowly through a small range around its rigid hinge'},{...direction,number:3,stage_id:'S08',state:'C' as const,environment_ref:'DECK',environment_description:'Carrier deck at sea',product_visual_state:'Operational carrier configuration',primary_action:'A tow tractor slowly repositions the aircraft',forbidden_elements:['extra aircraft','jet engines'],camera:{...direction.camera,angle:'front three-quarter'}}];for(const fixture of fixtures){const {sections}=normalizeOmniSections({},fixture,topic);const prompt=compileOmniPrompt(sections,fixture);assert.equal((prompt.match(/10-second continuous shot/gi)||[]).length,1);assert.doesNotMatch(prompt,/\[object Object\]|undefined|\b(?:and|of|for|on|the)\.$/i);}const operational=compileOmniPrompt(normalizeOmniSections({},fixtures[2],topic).sections,fixtures[2]);assert.match(operational,/maritime deck ambience/i);});
test('resolves contradictory camera metadata to one coherent instruction',()=>{
  const resolve=(camera:Partial<SceneDirection['camera']>,customTopic=topic)=>resolveProductionScene(customTopic,{...direction,camera:{...direction.camera,...camera}}).camera;
  assert.equal(resolve({movement:'static tracking pan'}).behavior,'locked camera');
  assert.equal(resolve({movement:'static dolly'}).behavior,'locked camera');
  assert.equal(resolve({lens:'wide-angle 50 mm'}).lens,'normal');
  assert.equal(resolve({shot_scale:'wide macro'}).shotScale,'macro close-up');
  assert.equal(resolve({movement:'slow pan then tracking'}).behavior,'locked camera');
  const guided=JSON.parse(JSON.stringify(handoff));guided.production_stages[0].camera_guidance={preferred_camera_movements:['slow lateral dolly'],forbidden_camera_movements:[]};
  assert.equal(resolve({movement:'static tracking'}, {...topic,_production_handoff:guided} as any).behavior,'slow lateral dolly');
  guided.production_stages[0].camera_guidance.forbidden_camera_movements=['dolly'];
  assert.equal(resolve({movement:'tracking'}, {...topic,_production_handoff:guided} as any).behavior,'restrained tracking movement');
  guided.production_stages[0].camera_guidance.forbidden_camera_movements=['tracking'];
  assert.equal(resolve({movement:'tracking'}, {...topic,_production_handoff:guided} as any).behavior,'locked camera');
});

test('preserves authoritative scene cameras when stage guidance lists multiple allowed choices',()=>{
  const guided=JSON.parse(JSON.stringify(handoff));
  guided.production_stages[0].camera_guidance={
    preferred_views:['Front three-quarter','Side three-quarter','Stage-relevant detail','Wide environmental establishing view'],
    safe_shot_scales:['EXTREME_WIDE','WIDE','MEDIUM','CLOSE_UP'],
    preferred_camera_movements:['Static tripod','Slow dolly','Slow lateral track','Controlled push-in'],
    forbidden_camera_movements:['Whip pan'],
  };
  const localTopic={...topic,_production_handoff:guided} as any;
  const cameras=[
    {shot_scale:'EXTREME_WIDE',lens:'35mm',angle:'Eye level',movement:'Static tripod',movement_speed:'None'},
    {shot_scale:'WIDE',lens:'50mm',angle:'Front three-quarter',movement:'Slow push-in',movement_speed:'Slow'},
    {shot_scale:'CLOSE_UP',lens:'85mm',angle:'High angle',movement:'Slow lateral track',movement_speed:'Slow'},
    {shot_scale:'MEDIUM',lens:'50mm',angle:'Side three-quarter',movement:'Slow dolly',movement_speed:'Very Slow'},
  ];
  const resolved=cameras.map(camera=>resolveProductionScene(localTopic,{...direction,camera}).camera);
  assert.deepEqual(resolved.map(camera=>camera.shotScale),['extreme-wide','wide','close-up','medium']);
  assert.deepEqual(resolved.map(camera=>camera.viewpoint),['eye level','front three-quarter','high angle','side three-quarter']);
  assert.deepEqual(resolved.map(camera=>camera.behavior),['locked camera','slow push-in','slow lateral tracking movement','slow dolly']);
  assert.deepEqual(resolved.map(camera=>camera.lens),['wide-angle','normal','short telephoto','normal']);
});

test('uses one strict deduplicated identity signature across finished-product views',()=>{
  const arTopic={...topic,_production_handoff:{...handoff,product:{official_name:'AR-2000',exact_variant:'AR-2000 shipborne rotary-wing UAS',immutable_identity_features:['cockpit-free fuselage','fixed landing gear']},geometry_modules:[{module_id:'FULL_PRODUCT',required_visible_features:['fixed landing gear','fixed landing gear sized for a roughly two-ton-class unmanned rotorcraft','single four-blade main rotor']}]} } as any;
  const signature=canonicalIdentitySignature(arTopic);
  assert.doesNotMatch(signature,/AR-2000 AR-2000/i);
  assert.equal((signature.match(/fixed landing gear/gi)||[]).length,1);
  const front={...direction,state:'C' as const,camera:{...direction.camera,angle:'front three-quarter'}};
  const rear={...direction,state:'C' as const,camera:{...direction.camera,angle:'rear three-quarter'}};
  const frontSections=normalizeOmniSections({},front,arTopic).sections;
  const rearSections=normalizeOmniSections({},rear,arTopic).sections;
  assert.ok(frontSections.product_state.startsWith(signature));
  assert.ok(rearSections.product_state.startsWith(signature));
});

test('normalizes negative grammar and recompiles locally without changing upstream fields',()=>{
  const finished={...direction,state:'C' as const,forbidden_elements:['Do not merge exhibition and shipboard variants','No pilot canopy','Avoid weapons']};
  const oldPrompt={number:1,stage_id:finished.stage_id,state:finished.state,action_description:'Original action',video_prompt:'legacy prompt',voiceover:'Exact VO',stock_keywords:'aircraft',continuity_notes:'unchanged',quality_flags:[],omniSections:normalizeOmniSections({exclusions:'Do not invent markings'},finished,topic).sections};
  const [compiled]=recompileOmniPrompts([oldPrompt],[{...finished,voiceover:'Exact VO'}],topic);
  assert.doesNotMatch(compiled.video_prompt,/Exclude (?:Do not|No|Avoid)/i);
  assert.match(compiled.video_prompt,/merging exhibition and shipboard variants/i);
  assert.equal(compiled.action_description,oldPrompt.action_description);
  assert.equal(compiled.stock_keywords,oldPrompt.stock_keywords);
  assert.equal(compiled.voiceover,'Exact VO');
  assert.equal(compiled.continuity_notes,oldPrompt.continuity_notes);
});

test('recompiles a 75-scene project in order with diverse cameras and a partial final scene',()=>{
  const cameras=[
    {shot_scale:'EXTREME_WIDE',lens:'24mm',angle:'Eye level',movement:'Slow forward aerial',movement_speed:'Slow'},
    {shot_scale:'WIDE',lens:'35mm',angle:'Front three-quarter',movement:'Slow push-in',movement_speed:'Slow'},
    {shot_scale:'MEDIUM',lens:'50mm',angle:'Side three-quarter',movement:'Slow dolly',movement_speed:'Very slow'},
    {shot_scale:'CLOSE_UP',lens:'85mm',angle:'High angle',movement:'Slow lateral track',movement_speed:'Slow'},
  ];
  const directions=Array.from({length:75},(_,index)=>({...direction,number:index+1,start:index*10,end:index===74?745.75:(index+1)*10,duration:index===74?5.75:10,voiceover:`Exact VO ${index+1}`,camera:cameras[index%cameras.length]}));
  const prompts=directions.map(item=>({number:item.number,stage_id:item.stage_id,state:item.state,action_description:item.primary_action,video_prompt:'legacy',voiceover:item.voiceover,stock_keywords:'assembly',continuity_notes:item.continuity_from_previous,quality_flags:[],omniSections:normalizeOmniSections({},item,topic).sections}));
  const compiled=recompileOmniPrompts(prompts,directions,topic);
  assert.deepEqual(compiled.map(item=>item.number),Array.from({length:75},(_,index)=>index+1));
  assert.equal(new Set(compiled.map(item=>item.omniSections?.cinematography)).size,4);
  assert.ok(compiled.every((item,index)=>item.voiceover===directions[index].voiceover));
  assert.match(compiled.at(-1)!.video_prompt,/^5\.75-second continuous shot\./);
  assert.ok(compiled.every(item=>(item.video_prompt.match(/\b\d+(?:\.\d+)?-second\b/gi)||[]).length===1));
  const averageWords=compiled.reduce((sum,item)=>sum+item.video_prompt.split(/\s+/).length,0)/compiled.length;
  assert.ok(averageWords<=160,`average prompt length was ${averageWords}`);
});
test('ranks exact counts, viewpoint anchors, and scene exclusions by relevance',()=>{
  const extended=JSON.parse(JSON.stringify(handoff));extended.product.immutable_identity_features.push('interior mission bay','overhead wing planform','generic low-priority feature');
  const localTopic={...topic,_production_handoff:extended} as any;
  const front=resolveProductionScene(localTopic,{...direction,required_visible_features:[],camera:{...direction.camera,angle:'front three-quarter'}});
  const rear=resolveProductionScene(localTopic,{...direction,required_visible_features:[],camera:{...direction.camera,angle:'rear three-quarter'}});
  const interior=resolveProductionScene(localTopic,{...direction,required_visible_features:[],camera:{...direction.camera,angle:'interior-oblique'}});
  const overhead=resolveProductionScene(localTopic,{...direction,required_visible_features:[],camera:{...direction.camera,angle:'overhead'}});
  assert.ok(front.identity.some(value=>/exactly two engine nacelles/i.test(value)));
  assert.ok(rear.identity.some(value=>/exactly four vertical fins/i.test(value)));
  assert.ok(interior.identity.some(value=>/interior mission bay/i.test(value)));
  assert.ok(overhead.identity.some(value=>/overhead wing planform/i.test(value)));
  const {sections}=normalizeOmniSections({exclusions:'generic vehicle, passenger windows, generic vehicle'},direction,localTopic);
  assert.doesNotMatch(sections.exclusions,/engines|rotodome|final paint/i);
  assert.equal((sections.exclusions.match(/generic vehicle/gi)||[]).length,1);
  assert.match(sections.exclusions,/automatic panel closure|generic airliner geometry/i);
});

test('normalizes legacy graphic treatments into photographic cinematic coverage',()=>{
  const temporal_action={opening_state:'Separated material layers hover in alignment',primary_motion:'The layers move together along one path',physical_interaction:'Their edges align without deformation',mid_shot_progression:'The relationship becomes visually clear',ending_state:'The layers settle into one clean stack'};
  for(const visual_treatment of ['STATIC_GRAPHIC_T2V','MOTION_GRAPHIC_T2V'] as const){
    const fixture={...direction,visual_family:'TECHNICAL_GRAPHIC' as const,visual_treatment,product_visibility:'DETAIL_ONLY' as const,temporal_action};
    const prompt=compileOmniPrompt(normalizeOmniSections({},fixture,topic).sections,fixture);
    assert.match(prompt,/cinematic shot observes|documented physical state|external/i);
    assert.match(prompt,/assembly hall|factory/i);
    assert.doesNotMatch(prompt,/premium technical vector|neutral technical space|diagram layers|floating arrows/i);
    assert.match(prompt,/Exclude [^.]*diagrams/i);
  }
  const detail={...direction,visual_treatment:'LIVE_ACTION_T2V' as const,product_visibility:'DETAIL_ONLY' as const,temporal_action};
  const prompt=compileOmniPrompt(normalizeOmniSections({},detail,topic).sections,detail);
  assert.match(prompt,/Show only this component detail/i);assert.doesNotMatch(prompt,/Preserve the same exact KJ-600/i);
});

test('never compiles legacy graphic specifications as positive graphic instructions',()=>{
  const graphic_spec={graphic_subtype:'HEAT_OR_ENERGY_FLOW' as const,visual_claim:'Show airflow progressing through one stable engine cross-section',composition:'ORTHOGRAPHIC_CUTAWAY' as const,motion_pattern:'HEAT_ZONE_PROGRESSION' as const,annotation_devices:['FLOW_LINES' as const,'COLORED_ZONE' as const],palette_profile:'PREMIUM_TECHNICAL_VECTOR' as const,maximum_animated_elements:2 as const,transition_anchor:'centered flow boundary',text_policy:'NO_GENERATED_TEXT' as const};
  const fixture={...direction,visual_family:'TECHNICAL_GRAPHIC' as const,visual_treatment:'MOTION_GRAPHIC_T2V' as const,product_visibility:'DETAIL_ONLY' as const,graphic_spec};
  const prompt=compileOmniPrompt(normalizeOmniSections({},fixture,topic).sections,fixture);
  assert.doesNotMatch(prompt,/premium technical vector explainer|cool-to-warm energy zone|final quarter|editor placeholders/i);
  assert.match(prompt,/Exclude [^.]*diagrams/i);assert.equal((prompt.match(/10-second continuous shot/gi)||[]).length,1);
});

test('compiles aircraft operational footage with physical sound and safety guards',()=>{
  const operationalTopic={...topic,_production_handoff:{...handoff,product:{...handoff.product,product_class:'combat helicopter'}}} as any;
  const temporal_action={opening_state:'The complete helicopter holds a low hover',primary_motion:'It accelerates into a shallow bank',physical_interaction:'Rotor downwash pushes dust outward across the apron',mid_shot_progression:'The aircraft gains forward speed without changing configuration',ending_state:'It settles into stable level transit'};
  const fixture={...direction,state:'C' as const,visual_family:'OPERATIONAL_CONTEXT' as const,visual_treatment:'LIVE_ACTION_T2V' as const,product_visibility:'FULL' as const,primary_action:'The helicopter performs one controlled flight drill',showdown_role:'ENVIRONMENTAL_SPECTACLE' as const,energy_level:'HIGH' as const,camera_platform:'CHASE_AIRCRAFT' as const,temporal_action};
  const prompt=compileOmniPrompt(normalizeOmniSections({},fixture,operationalTopic).sections,fixture);
  assert.match(prompt,/rotor, engine, airflow/i);assert.match(prompt,/downwash/i);assert.match(prompt,/weapon discharge/i);assert.match(prompt,/impossible aerobatics/i);assert.match(prompt,/physically credible chase aircraft/i);assert.match(prompt,/physically caused cloud, vapor, heat haze/i);assert.match(prompt,/camera passing through the aircraft/i);assert.equal((prompt.match(/10-second continuous shot/gi)||[]).length,1);
});

test('compacts locally generated overflow while retaining variant configuration guards',()=>{
  const guardedTopic={...topic,_production_handoff:{...handoff,product:{...handoff.product,official_name:'OceanAlpha M75 Security Patrol USV',exact_variant:'M75 current security patrol / offshore patrol configuration; dark-hull and white-hull reference configurations must not be mixed within a generated sequence',global_negative_constraints:['do not mix white-hull and dark-hull configurations within one sequence']}}} as any;
  const verbose=Object.fromEntries(['cinematography','subject','action','environment','style_lighting','product_state','sound','exclusions'].map(field=>[field,`${field} ${'precise documentary detail '.repeat(70)}`]));
  const normalized=normalizeOmniSections(verbose,direction,guardedTopic).sections;
  const prompt=compileOmniPrompt(normalized,direction);
  assert.ok(countPromptWords(prompt)<=MAX_VIDEO_PROMPT_WORDS,`prompt contained ${countPromptWords(prompt)} words`);
  assert.match(prompt,/10-second continuous shot/i);
  assert.match(prompt,/dark-hull and white-hull/i);
  assert.match(prompt,/Exclude dialogue, narration, music/i);
});
