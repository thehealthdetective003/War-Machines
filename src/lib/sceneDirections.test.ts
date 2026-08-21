import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateStageSummary, mergeDirectionMetadata, validateSceneDirections } from './sceneDirections';

const timed = [{ number: 1, start: 0, end: 10, duration: 10, text: 'Hello.', silent: false }];
const generated = [{ number: 1, stage_id: 'S01', state: 'A', subject: 'Raw aluminum billet', product_visual_state: 'Unfinished raw stock', primary_action: 'A crane lowers the billet', supporting_motion: 'Coolant mist drifts', environment_ref: 'E01', environment_description: 'Steel receiving bay', camera: { shot_scale: 'wide', lens: '35mm', angle: 'low', movement: 'push in', movement_speed: 'slow' }, lighting_and_material: 'Cool LED on brushed metal', continuity_from_previous: 'Opening state', transition_to_next: 'Billet enters machining', required_visible_features: ['rectangular billet'], forbidden_elements: ['finished product'] }];

test('merges immutable imported timing and validates complete directions', () => {
  const merged = mergeDirectionMetadata(generated, timed, [], 6);
  assert.equal(merged[0].voiceover, 'Hello.');
  assert.equal(merged[0].generation_duration_seconds, 6);
  assert.deepEqual(validateSceneDirections(merged, timed, undefined, 6), []);
});

test('keeps a partial transcript duration separate from the full generated clip duration', () => {
  const partial = [{ number:1,start:0,end:1.25,duration:1.25,text:'Final words',silent:false }];
  const merged = mergeDirectionMetadata(generated, partial, [], 6);
  assert.equal(merged[0].duration, 1.25);
  assert.equal(merged[0].generation_duration_seconds, 6);
  assert.deepEqual(validateSceneDirections(merged, partial, undefined, 6), []);
});

test('rejects modified imported metadata', () => {
  const merged = mergeDirectionMetadata(generated, timed);
  merged[0].voiceover = 'Changed';
  assert.ok(validateSceneDirections(merged, timed).some(error => error.includes('modified')));
});

test('validates a later semantic batch by explicit scene number rather than array offset',()=>{
  const laterTimed=[{number:61,start:360,end:366,duration:6,text:'Later scene.',silent:false}];
  const laterGenerated=[{...generated[0],number:61}];
  const merged=mergeDirectionMetadata(laterGenerated,laterTimed,[],6);
  assert.deepEqual(validateSceneDirections(merged,laterTimed,undefined,6),[]);
});

test('attaches immutable stage and environment metadata locally from the scene plan', () => {
  const plan = [{ number:1, chapter_id:'CH01', beat_id:'B01', visual_family:'ASSEMBLY_PROCESS', story_function:'EXPLAIN_PROCESS', visual_treatment:'LIVE_ACTION_T2V', product_visibility:'PARTIAL', stage_id:'PLANNED_STAGE', environment_ref:'PLANNED_ENV', state:'B' }] as const;
  const responseWithoutPlanFields = [{ ...generated[0], stage_id:undefined, environment_ref:undefined, state:'INVALID', temporal_action:{opening_state:'Part rests in jig',primary_motion:'Tool lowers',physical_interaction:'Tool contacts part',mid_shot_progression:'Fastener seats',ending_state:'Tool lifts'} }];
  const merged = mergeDirectionMetadata(responseWithoutPlanFields, timed, plan as any);
  assert.equal(merged[0].stage_id, 'PLANNED_STAGE');
  assert.equal(merged[0].environment_ref, 'PLANNED_ENV');
  assert.equal(merged[0].state, 'B');
  assert.deepEqual(validateSceneDirections(merged, timed, plan as any), []);
});

test('repairs an empty visible-feature list for a non-product atmospheric scene',()=>{
  const plan=[{number:1,chapter_id:'CH01',beat_id:'RESET',visual_family:'ATMOSPHERIC_INTERSTITIAL',story_function:'RESET_ATTENTION',visual_treatment:'LIVE_ACTION_T2V',product_visibility:'NONE',stage_id:'S01',environment_ref:'E01',state:'A'}] as const;
  const response=[{...generated[0],required_visible_features:[],environment_description:'Empty test apron with wind moving dust',temporal_action:{opening_state:'Empty apron',primary_motion:'Wind moves dust',physical_interaction:'Dust crosses concrete',mid_shot_progression:'Shadows lengthen',ending_state:'The empty apron settles'}}];
  const merged=mergeDirectionMetadata(response,timed,plan as any);
  assert.deepEqual(merged[0].required_visible_features,['Empty test apron with wind moving dust']);
  assert.deepEqual(validateSceneDirections(merged,timed,plan as any),[]);
});

test('returns a render-safe array for the Phase 2 stage summary', () => {
  const directions = [
    ...mergeDirectionMetadata(generated, timed),
    { ...mergeDirectionMetadata(generated, timed)[0], number: 2 },
    { ...mergeDirectionMetadata(generated, timed)[0], number: 3, stage_id: 'S02' },
  ];
  assert.deepEqual(calculateStageSummary(directions), [
    { stage_id: 'S01', scenes: 2 },
    { stage_id: 'S02', scenes: 1 },
  ]);
  assert.deepEqual(calculateStageSummary([]), []);
});
