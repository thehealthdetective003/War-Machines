import type { PlannedScene, SceneDirection, TimedScene, TopicBrief } from '../types';
import { stableSerialize } from './operationFingerprint';

export function sceneReviewDependencyFingerprint(operation:'DIRECTION'|'PROMPT',topic:TopicBrief|null,scene:TimedScene,plan:PlannedScene|SceneDirection,direction?:SceneDirection):string{
  const handoff=(topic as any)?._production_handoff;
  const dependencyPlan=operation==='PROMPT'&&direction?direction:plan;
  return stableSerialize({operation,scene,plan:dependencyPlan,direction:operation==='PROMPT'?direction:undefined,handoffSchema:handoff?.schema,handoffProduct:handoff?.product,stage:handoff?.production_stages?.find((item:any)=>item.stage_id===dependencyPlan.stage_id),beat:(handoff?.visual_story_plan?.chapters||[]).flatMap((chapter:any)=>chapter.visual_beats||[]).find((item:any)=>item.beat_id===(dependencyPlan.contract_beat_id||dependencyPlan.beat_id)),environment:handoff?.environments?.find((item:any)=>item.environment_id===dependencyPlan.environment_ref)});
}
