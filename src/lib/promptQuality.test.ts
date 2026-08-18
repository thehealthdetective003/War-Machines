import assert from 'node:assert/strict';
import test from 'node:test';
import { detectedCameraMovements, isAdvisoryPromptQualityIssue, promptQualityIssues } from './promptQuality';
import { compileOmniPrompt, normalizeOmniSections } from './omniPromptCompiler';

const direction:any={number:1,generation_duration_seconds:6,product_visibility:'DETAIL_ONLY',required_visible_features:['four vertical support legs']};
const prompt=(video_prompt:string):any=>({number:1,video_prompt,action_description:'action',voiceover:'',stock_keywords:''});
const omniPrompt=(cinematography:string,action:string):any=>({...prompt(`6-second continuous shot. ${cinematography}. ${action}. Four vertical support legs remain visible.`),omniSections:{cinematography,subject:'four vertical support legs',action,environment:'factory',style_lighting:'neutral light',product_state:'partial assembly',sound:'factory ambience',exclusions:'no orbit or handheld movement'}});

test('accepts one concise camera instruction with an identity anchor',()=>{
  assert.deepEqual(promptQualityIssues(prompt('6-second continuous shot. Use a wide locked camera while four vertical support legs remain visible and one crane lowers a module.'),direction),[]);
});

test('rejects conflicting cameras, malformed grammar, and oversized prompts',()=>{
  const issues=promptQualityIssues(prompt(`6-second continuous shot. Use a locked camera and a slow pan. Use a extreme-wide view view. four vertical support legs. ${'detail '.repeat(290)}`),direction);
  assert.ok(issues.includes('MULTIPLE_CAMERA_MOVEMENTS'));assert.ok(issues.includes('MALFORMED_PROMPT_GRAMMAR'));assert.ok(issues.includes('INVALID_ARTICLE'));assert.ok(issues.includes('PROMPT_OVER_280_WORDS'));
});

test('does not mistake a subject-mounted sensor camera for filming-camera movement',()=>{
  const value='6-second continuous shot. Use a locked camera while four vertical support legs remain visible. Electro-optical cameras pan across the water as part of the subject payload.';
  assert.deepEqual(promptQualityIssues(prompt(value),direction),[]);
});

test('does not mistake subject or environmental motion for filming-camera movement',()=>{
  const cases=['The vessel glides slowly forward','The worker pulls back the tool','The crane rises with the component','The aircraft tracks the coastline','The robotic arm pans across the workpiece','Water pushes inward around the hull'];
  for(const action of cases)assert.deepEqual(promptQualityIssues(omniPrompt('Use a high-angle extreme-wide view with one locked camera',action),direction),[],action);
});

test('uses normalized Omni cinematography instead of scanning physical action for camera verbs',()=>{
  const candidate=omniPrompt('Use a high-angle extreme-wide view on a wide-angle lens with one locked camera','The vessel glides forward steadily while tracking near a distant platform');
  assert.deepEqual([...detectedCameraMovements(candidate)],['LOCKED']);
  assert.deepEqual(promptQualityIssues(candidate,direction),[]);
});

test('detects genuine structured camera conflicts and deduplicates equivalent instructions',()=>{
  const conflict=omniPrompt('Use a locked tripod while the camera slowly pans','The vessel moves forward');
  assert.ok(promptQualityIssues(conflict,direction).includes('MULTIPLE_CAMERA_MOVEMENTS'));
  const duplicate=omniPrompt('Use a locked camera on a static tripod','The vessel moves forward');
  assert.deepEqual([...detectedCameraMovements(duplicate)],['LOCKED']);
  assert.deepEqual(promptQualityIssues(duplicate,direction),[]);
});

test('does not count negative camera constraints as requested movements',()=>{
  const candidate=omniPrompt('Use a locked camera with no orbit, push-in, pull-back, or handheld movement','The vessel moves laterally');
  assert.deepEqual([...detectedCameraMovements(candidate)],['LOCKED']);
  assert.deepEqual(promptQualityIssues(candidate,direction),[]);
});

test('keeps only camera-conflict diagnostics advisory after correction',()=>{
  assert.equal(isAdvisoryPromptQualityIssue('MULTIPLE_CAMERA_MOVEMENTS'),true);
  assert.equal(isAdvisoryPromptQualityIssue('PROMPT_OVER_280_WORDS'),false);
  assert.equal(isAdvisoryPromptQualityIssue('MISSING_GENERATION_DURATION'),false);
});

test('compiles a static-camera direction with forward vessel motion without a camera conflict',()=>{
  const operationalDirection:any={number:76,start:450,end:456,duration:6,generation_duration_seconds:6,voiceover:'The autonomous vessel continues its mission.',silent:false,visual_family:'OPERATIONAL_CONTEXT',visual_treatment:'LIVE_ACTION_T2V',product_visibility:'FULL',stage_id:'STG_07',environment_ref:'ENV_OFFSHORE',state:'C',subject:'autonomous vessel',product_visual_state:'Finished operational State C',primary_action:'The vessel navigates autonomously',supporting_motion:'The vessel tracks near distant infrastructure',environment_description:'A generic offshore operating context',camera:{shot_scale:'EXTREME_WIDE',lens:'WIDE_ANGLE',angle:'HIGH_ANGLE',movement:'STATIC',movement_speed:'NONE'},lighting_and_material:'Marine daylight',continuity_from_previous:'Same configuration',transition_to_next:'Closer view',required_visible_features:['autonomous vessel'],forbidden_elements:['readable generated text'],temporal_action:{opening_state:'The vessel is already underway',primary_motion:'The vessel glides forward steadily',physical_interaction:'A continuous wake follows the hull',mid_shot_progression:'The vessel maintains a stable attitude',ending_state:'The vessel continues its forward progress'}};
  const {sections}=normalizeOmniSections({},operationalDirection,null),video_prompt=compileOmniPrompt(sections,operationalDirection),candidate:any={number:76,video_prompt,action_description:operationalDirection.primary_action,voiceover:operationalDirection.voiceover,stock_keywords:'vessel',omniSections:sections};
  assert.match(video_prompt,/vessel glides forward steadily/i);
  assert.deepEqual([...detectedCameraMovements(candidate)],['LOCKED']);
  assert.deepEqual(promptQualityIssues(candidate,operationalDirection),[]);
});
