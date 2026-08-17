import { SceneDirection, T2VPrompt } from '../types';

export const T2V_BATCH_SIZE = 30;

export function createDirectionBatches(directions: SceneDirection[], size = T2V_BATCH_SIZE): SceneDirection[][] {
  const batches: SceneDirection[][] = [];
  for (let index = 0; index < directions.length; index += size) batches.push(directions.slice(index, index + size));
  return batches;
}

export function missingDirections(directions: SceneDirection[], prompts: T2VPrompt[]): SceneDirection[] {
  const completed = new Set(prompts.map(prompt => prompt.number));
  return directions.filter(direction => !completed.has(direction.number));
}

export function validateBatchResponse(raw: unknown, requested: SceneDirection[]): any[] {
  const items = validateBatchNumbers(raw, requested);
  for (const item of items) {
    const number = Number(item?.number);
    if (typeof item?.video_prompt !== 'string' || !item.video_prompt.trim()) throw new Error(`Scene ${number} has no T2V prompt.`);
  }
  return items;
}

export function validateBatchNumbers(raw: unknown, requested: SceneDirection[]): any[] {
  if (!Array.isArray(raw)) throw new Error('Gemini returned a non-array batch response.');
  const expected = new Set(requested.map(scene => scene.number));
  const seen = new Set<number>();
  for (const item of raw) {
    const number = Number(item?.number);
    if (!Number.isInteger(number)) throw new Error('Gemini returned an invalid scene number.');
    if (!expected.has(number)) throw new Error(`Gemini returned unexpected scene ${number}.`);
    if (seen.has(number)) throw new Error(`Gemini duplicated scene ${number}.`);
    seen.add(number);
  }
  const missing = requested.map(scene => scene.number).filter(number => !seen.has(number));
  if (missing.length) throw new Error(`Gemini omitted scene${missing.length > 1 ? 's' : ''} ${missing.join(', ')}.`);
  if (raw.length !== requested.length) throw new Error('Gemini returned an incorrect number of scenes.');
  return raw;
}

export function mergePromptBatch(existing: T2VPrompt[], batch: T2VPrompt[]): T2VPrompt[] {
  const merged = new Map(existing.map(prompt => [prompt.number, prompt]));
  batch.forEach(prompt => merged.set(prompt.number, prompt));
  return [...merged.values()].sort((a, b) => a.number - b.number);
}

export class PromptBatchError extends Error {
  constructor(message: string, public readonly batch: SceneDirection[], public readonly accumulated: T2VPrompt[], public readonly uncommitted: T2VPrompt[] = accumulated) { super(message); }
}

export async function runSequentialBatches(
  batches: SceneDirection[][],
  initial: T2VPrompt[],
  generate: (batch: SceneDirection[]) => Promise<T2VPrompt[]>,
  onStart: (batch: SceneDirection[], accumulated: T2VPrompt[]) => void | Promise<void>,
  onCommit: (batch: SceneDirection[], accumulated: T2VPrompt[]) => void | Promise<void>,
): Promise<T2VPrompt[]> {
  let accumulated = [...initial];
  for (const batch of batches) {
    let next = accumulated;
    try {
      await onStart(batch, accumulated);
      next = mergePromptBatch(accumulated, await generate(batch));
      await onCommit(batch, next);
      accumulated = next;
    } catch (error) {
      throw new PromptBatchError(error instanceof Error ? error.message : 'Batch generation failed.', batch, accumulated, next);
    }
  }
  return accumulated;
}
