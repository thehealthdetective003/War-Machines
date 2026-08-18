import type { SceneDirection, T2VPrompt } from '../types';
import { countPromptWords, MAX_VIDEO_PROMPT_WORDS } from './promptLimits';

const movementLabels:Array<[RegExp,string]>=[
  [/\blocked camera\b|\bstatic tripod\b/i,'locked'],
  [/\bslow pan\b|\b(?:the|a|one|filming) camera (?:slowly )?pan(?:s|ning)?\b/i,'pan'],
  [/\bpush(?:es)?[- ]?in\b/i,'push-in'],
  [/\bpull(?:s)?[- ]?back\b/i,'pull-back'],
  [/\blateral (?:track|tracking|dolly)\b|\btracks? laterally\b/i,'lateral'],
  [/\bcrane rise\b|\bcamera rises\b/i,'crane-rise'],
  [/\bglides? (?:slowly )?forward\b|\bforward aerial\b/i,'forward'],
];
const normalized=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();

export function promptQualityIssues(prompt:T2VPrompt,direction:SceneDirection):string[]{
  const value=prompt.video_prompt||'',issues:string[]=[];
  if(countPromptWords(value)>MAX_VIDEO_PROMPT_WORDS)issues.push('PROMPT_OVER_280_WORDS');
  if(/\ba (?:extreme-wide|aerial|overhead)\b/i.test(value))issues.push('INVALID_ARTICLE');
  if(/\bview view\b|\.\s*;|\[object Object\]/i.test(value))issues.push('MALFORMED_PROMPT_GRAMMAR');
  const movements=new Set(movementLabels.filter(([pattern])=>pattern.test(value)).map(([,label])=>label));
  if(movements.size>1)issues.push('MULTIPLE_CAMERA_MOVEMENTS');
  if(!value.toLowerCase().includes('second continuous shot'))issues.push('MISSING_GENERATION_DURATION');
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
