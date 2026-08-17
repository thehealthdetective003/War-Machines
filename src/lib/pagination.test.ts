import test from 'node:test';
import assert from 'node:assert/strict';
import { clampPromptPage, PROMPT_PAGE_SIZE, promptPageCount, promptPageItems } from './pagination';

test('renders at most 20 editors and clamps pages after project changes', () => {
  const prompts=Array.from({length:95},(_,index)=>index+1);
  assert.equal(PROMPT_PAGE_SIZE,20);
  assert.equal(promptPageCount(prompts.length),5);
  assert.deepEqual(promptPageItems(prompts,5),prompts.slice(80,95));
  assert.equal(promptPageItems(prompts,2).length,20);
  assert.equal(clampPromptPage(9,17),1);
});
