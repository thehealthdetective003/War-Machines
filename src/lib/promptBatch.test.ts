import test from 'node:test';
import assert from 'node:assert/strict';
import { createDirectionBatches, mergePromptBatch, missingDirections, PromptBatchError, runSequentialBatches, validateBatchResponse } from './promptBatch';
import type { SceneDirection, T2VPrompt } from '../types';

const directions = (count:number) => Array.from({length:count},(_,index)=>({number:index+1} as SceneDirection));
test('creates fixed 30-scene batches', () => {
  assert.deepEqual([1,30,31,60,61].map(count=>createDirectionBatches(directions(count)).map(batch=>batch.length)), [[1],[30],[30,1],[30,30],[30,30,1]]);
});
test('accepts an exact batch and rejects missing, duplicate, and extra scenes', () => {
  const requested=directions(2); const item=(number:number)=>({number,video_prompt:'prompt'});
  assert.equal(validateBatchResponse([item(1),item(2)],requested).length,2);
  assert.throws(()=>validateBatchResponse([item(1)],requested),/omitted scene 2/);
  assert.throws(()=>validateBatchResponse([item(1),item(1)],requested),/duplicated scene 1/);
  assert.throws(()=>validateBatchResponse([item(1),item(3)],requested),/unexpected scene 3/);
});
test('finds missing directions and merges completed batches in scene order', () => {
  const prompt=(number:number)=>({number,video_prompt:'p',action_description:'a',voiceover:'',stock_keywords:''} as T2VPrompt);
  assert.deepEqual(missingDirections(directions(4),[prompt(1),prompt(2)]).map(scene=>scene.number),[3,4]);
  assert.deepEqual(mergePromptBatch([prompt(2)],[prompt(1)]).map(item=>item.number),[1,2]);
});
test('runs batches sequentially and preserves committed prompts when a later batch fails', async () => {
  const batches=createDirectionBatches(directions(61)); const events:string[]=[];
  const prompt=(number:number)=>({number,video_prompt:'p',action_description:'a',voiceover:'',stock_keywords:''} as T2VPrompt);
  await assert.rejects(()=>runSequentialBatches(batches,[],async batch=>{ events.push(`generate:${batch[0].number}`); if(batch[0].number===31) throw new Error('failed'); return batch.map(scene=>prompt(scene.number)); },()=>{},(batch,items)=>{events.push(`commit:${batch[0].number}:${items.length}`);}), (error:any)=>{
    assert.ok(error instanceof PromptBatchError); assert.equal(error.accumulated.length,30); return true;
  });
  assert.deepEqual(events,['generate:1','commit:1:30','generate:31']);
});
test('does not start a later batch when durable checkpointing fails', async () => {
  const batches=createDirectionBatches(directions(61)); const generated:number[]=[]; const committed:number[]=[];
  const prompt=(number:number)=>({number,video_prompt:'p',action_description:'a',voiceover:'',stock_keywords:''} as T2VPrompt);
  await assert.rejects(()=>runSequentialBatches(batches,[],async batch=>{generated.push(batch[0].number);return batch.map(scene=>prompt(scene.number));},()=>{},async(batch,items)=>{
    if(batch[0].number===31)throw new DOMException('Quota exceeded','QuotaExceededError');
    committed.push(items.length);
  }),(error:any)=>error instanceof PromptBatchError&&error.accumulated.length===30&&error.uncommitted.length===60);
  assert.deepEqual(generated,[1,31]);
  assert.deepEqual(committed,[30]);
});
