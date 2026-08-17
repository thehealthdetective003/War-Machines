import type { GenerationSession } from '../types';

export const idleGenerationSession=():GenerationSession=>({
  status:'idle',
  totalBatches:0,
  currentBatch:0,
  batchStartScene:null,
  batchEndScene:null,
  completedScenes:0,
  startedAt:null,
  lastCommittedAt:null,
  error:null,
});

export function normalizeGenerationSession(value:unknown,completedScenes=0):GenerationSession{
  if(!value||typeof value!=='object'||Array.isArray(value))return {...idleGenerationSession(),completedScenes};
  const session=value as Partial<GenerationSession>;
  return {
    ...idleGenerationSession(),
    ...session,
    completedScenes:Number.isFinite(Number(session.completedScenes))?Number(session.completedScenes):completedScenes,
    status:['idle','running','paused','interrupted','failed','complete'].includes(String(session.status))?session.status as GenerationSession['status']:'idle',
  };
}
