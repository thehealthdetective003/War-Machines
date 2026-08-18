import assert from 'node:assert/strict';
import test from 'node:test';
import { promptQualityIssues } from './promptQuality';

const direction:any={number:1,generation_duration_seconds:6,product_visibility:'DETAIL_ONLY',required_visible_features:['four vertical support legs']};
const prompt=(video_prompt:string):any=>({number:1,video_prompt,action_description:'action',voiceover:'',stock_keywords:''});

test('accepts one concise camera instruction with an identity anchor',()=>{
  assert.deepEqual(promptQualityIssues(prompt('6-second continuous shot. Use a wide locked camera while four vertical support legs remain visible and one crane lowers a module.'),direction),[]);
});

test('rejects conflicting cameras, malformed grammar, and oversized prompts',()=>{
  const issues=promptQualityIssues(prompt(`6-second continuous shot. Use a locked camera and a slow pan. Use a extreme-wide view view. four vertical support legs. ${'detail '.repeat(290)}`),direction);
  assert.ok(issues.includes('MULTIPLE_CAMERA_MOVEMENTS'));assert.ok(issues.includes('MALFORMED_PROMPT_GRAMMAR'));assert.ok(issues.includes('INVALID_ARTICLE'));assert.ok(issues.includes('PROMPT_OVER_280_WORDS'));
});
