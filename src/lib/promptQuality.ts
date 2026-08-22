import type { SceneDirection, T2VPrompt } from '../types';
import { countPromptWords, MAX_VIDEO_PROMPT_WORDS } from './promptLimits';
import { containsGraphicPromptLanguage } from './cinematicPolicy';

export type CanonicalCameraMovement='LOCKED'|'PAN'|'TILT'|'PUSH_IN'|'PULL_BACK'|'LATERAL_TRACK'|'FOLLOW_TRACK'|'CRANE'|'ORBIT'|'HANDHELD'|'AERIAL_FORWARD';
const structuredMovementLabels:Array<[RegExp,CanonicalCameraMovement]>=[
  [/\b(?:locked|static|stationary|tripod)\b/i,'LOCKED'],[/\bpan(?:s|ning)?\b/i,'PAN'],[/\btilt(?:s|ing)?\b/i,'TILT'],[/\bpush(?:es)?[- ]?in\b|\bmove(?:s|ment)? closer\b/i,'PUSH_IN'],[/\bpull(?:s)?[- ]?back\b|\bmove(?:s|ment)? away\b/i,'PULL_BACK'],[/\blateral (?:track|tracking|dolly|movement)\b|\bsideways dolly\b/i,'LATERAL_TRACK'],[/\b(?:follow|following|tracking) (?:camera|movement|shot)\b|\bcamera (?:follows|tracks)\b/i,'FOLLOW_TRACK'],[/\bcrane (?:camera|shot|rise|descent|movement)\b|\bcamera (?:rises|descends)\b/i,'CRANE'],[/\borbit(?:s|ing)?\b/i,'ORBIT'],[/\bhandheld\b/i,'HANDHELD'],[/\b(?:aerial camera|camera|shot|view) (?:glides?|moves?) (?:slowly )?forward\b|\bforward aerial (?:camera|movement|glide|shot)\b/i,'AERIAL_FORWARD'],
];
const unstructuredMovementLabels:Array<[RegExp,CanonicalCameraMovement]>=[
  [/\b(?:locked|static|stationary) (?:camera|shot|view|tripod)\b|\b(?:camera|shot|view|tripod) (?:is )?(?:locked|static|stationary)\b|\bstatic tripod\b/i,'LOCKED'],
  [/\bslow pan\b|\b(?:the|a|one|filming) camera (?:slowly )?pan(?:s|ning)?\b|\b(?:shot|view) (?:slowly )?pans?\b/i,'PAN'],
  [/\b(?:camera|shot|view) (?:slowly )?tilt(?:s|ing)?\b|\bslow tilt\b/i,'TILT'],
  [/\bpush[- ]in\b|\b(?:camera|shot|view) (?:slowly )?push(?:es)? in\b/i,'PUSH_IN'],
  [/\bpull[- ]back\b|\b(?:camera|shot|view) (?:slowly )?pull(?:s)? back\b/i,'PULL_BACK'],
  [/\blateral (?:camera |shot |view )?(?:track|tracking|dolly|movement)\b|\b(?:camera|shot|view|dolly) tracks? laterally\b/i,'LATERAL_TRACK'],
  [/\b(?:camera|shot|view) (?:follows|tracks) (?:the )?subject\b|\bfollowing camera\b/i,'FOLLOW_TRACK'],
  [/\bcrane (?:camera|shot|camera movement)\b|\b(?:camera|shot|view) (?:slowly )?(?:rises|descends)\b/i,'CRANE'],
  [/\b(?:camera|shot|view) orbit(?:s|ing)?\b|\borbiting (?:camera|shot|view)\b/i,'ORBIT'],
  [/\bhandheld (?:camera|shot|view|movement)\b/i,'HANDHELD'],
  [/\b(?:aerial camera|camera|shot|view) (?:glides?|moves?) (?:slowly )?forward\b|\bforward aerial (?:camera|movement|glide|shot)\b/i,'AERIAL_FORWARD'],
];
const normalized=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const requestedCameraText=(value:string)=>value.replace(/\b(?:no|without|avoid|exclude|never|do not)\b[^.!?]*/gi,' ');

export function detectedCameraMovements(prompt:T2VPrompt):Set<CanonicalCameraMovement>{
  const structured=prompt.omniSections?.cinematography?.trim(),value=requestedCameraText(structured||prompt.video_prompt||''),labels=structured?structuredMovementLabels:unstructuredMovementLabels;
  return new Set(labels.filter(([pattern])=>pattern.test(value)).map(([,label])=>label));
}

export const isAdvisoryPromptQualityIssue=(issue:string)=>issue==='MULTIPLE_CAMERA_MOVEMENTS';

export function promptQualityIssues(prompt:T2VPrompt,direction:SceneDirection):string[]{
  const value=prompt.video_prompt||'',issues:string[]=[];
  if(countPromptWords(value)>MAX_VIDEO_PROMPT_WORDS)issues.push('PROMPT_OVER_280_WORDS');
  if(/\ba (?:extreme-wide|aerial|overhead)\b/i.test(value))issues.push('INVALID_ARTICLE');
  if(/\bview view\b|\.\s*;|\[object Object\]/i.test(value))issues.push('MALFORMED_PROMPT_GRAMMAR');
  const movements=detectedCameraMovements(prompt);
  if(movements.size>1)issues.push('MULTIPLE_CAMERA_MOVEMENTS');
  if(!value.toLowerCase().includes('second continuous shot'))issues.push('MISSING_GENERATION_DURATION');
  if(containsGraphicPromptLanguage(value))issues.push('ACTIVE_GRAPHIC_PROMPT_LANGUAGE');
  const required=(direction.required_visible_features||[]).slice(0,3).map(normalized).filter(Boolean);
  if(direction.product_visibility!=='NONE'&&required.length&&!required.some(feature=>{
    const significant=feature.split(' ').filter(word=>word.length>4).slice(0,3);return significant.some(word=>normalized(value).includes(word));
  }))issues.push('MISSING_IDENTITY_ANCHOR');
  return issues;
}

export function validatePromptSet(prompts:T2VPrompt[],directions:SceneDirection[]):string[]{
  const byNumber=new Map(directions.map(direction=>[direction.number,direction]));
  return prompts.flatMap(prompt=>{const direction=byNumber.get(prompt.number);return direction?promptQualityIssues(prompt,direction).map(issue=>`Scene ${prompt.number}: ${issue}`):[`Scene ${prompt.number}: UNKNOWN_DIRECTION`];});
}
