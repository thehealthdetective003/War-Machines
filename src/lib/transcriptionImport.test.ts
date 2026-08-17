import test from 'node:test';
import assert from 'node:assert/strict';
import { importTranscriptionJson } from './transcriptionImport';

test('imports word timestamp JSON and preserves silent windows', () => {
  const result = importTranscriptionJson({ duration: 21, words: [{ word:'Hello',start:0,end:1 },{ word:'world',start:20,end:20.5 }] }, 'vo.json', 10);
  assert.equal(result.scenes.length, 3);
  assert.equal(result.scenes[1].silent, true);
  assert.equal(result.scenes[2].text, 'world');
});

test('rejects JSON without word timestamps', () => assert.throws(() => importTranscriptionJson({ text:'Hello' }, 'vo.json', 10), /word-level/));

test('preserves exact pre-split scenes without word data', () => {
  const result = importTranscriptionJson({ duration:18, scenes:[{start:0,end:10,text:'First scene'},{start:10,end:18,text:'Second scene'}] }, 'scenes.json', 10);
  assert.deepEqual(result.scenes.map(scene=>[scene.start,scene.end,scene.text]), [[0,10,'First scene'],[10,18,'Second scene']]);
});
