import { TimedTranscriptSegment, TimedWord, VoiceoverTranscription } from '../types';
import { buildTimedScenes } from './timedTranscript';
import { positiveSceneDuration } from './sceneDuration';

const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value);

export function importTranscriptionJson(raw: any, fileName: string, sceneDuration: number): VoiceoverTranscription {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Transcription JSON must be an object.');
  const validSceneDuration = positiveSceneDuration(sceneDuration);
  if (validSceneDuration === null) throw new Error('Scene duration must be a positive number.');
  sceneDuration = validSceneDuration;
  const sourceWords = Array.isArray(raw.words) ? raw.words : Array.isArray(raw.result?.words) ? raw.result.words : [];
  const words: TimedWord[] = sourceWords.map((word: any, index: number) => {
    const start = Number(word.start ?? word.start_time);
    const end = Number(word.end ?? word.end_time);
    const text = String(word.text ?? word.word ?? '').trim();
    if (!finite(start) || !finite(end) || end < start || !text) throw new Error(`Invalid word timestamp at index ${index}.`);
    return { text: `${index ? ' ' : ''}${text}`, start, end, probability: Number(word.probability ?? word.prob ?? 1) };
  });
  words.sort((a,b) => a.start - b.start);
  const rawScenes = Array.isArray(raw.scenes) ? raw.scenes : Array.isArray(raw.timed_scenes) ? raw.timed_scenes : [];
  const rawSegments = Array.isArray(raw.segments) ? raw.segments : Array.isArray(raw.result?.segments) ? raw.result.segments : [];
  const segments: TimedTranscriptSegment[] = rawSegments.map((segment: any) => ({
    start: Number(segment.start || 0), end: Number(segment.end || 0), text: String(segment.text || '').trim(),
    words: Array.isArray(segment.words) ? segment.words.map((word:any) => ({ text:String(word.text ?? word.word ?? ''), start:Number(word.start), end:Number(word.end), probability:Number(word.probability ?? 1) })) : [],
  })).filter(segment => finite(segment.start) && finite(segment.end));
  const exactSource = rawScenes.length ? rawScenes : (!words.length ? rawSegments : []);
  const exactScenes = exactSource.map((scene:any,index:number) => {
    const start = Number(scene.start ?? scene.start_time ?? scene.timestamp?.[0]);
    const end = Number(scene.end ?? scene.end_time ?? scene.timestamp?.[1]);
    const text = String(scene.text ?? scene.voiceover ?? scene.transcript ?? '').trim();
    if (!finite(start) || !finite(end) || end <= start) throw new Error(`Invalid scene timestamp at index ${index}.`);
    const expectedStart = index * sceneDuration;
    if (Math.abs(start - expectedStart) > 0.01) throw new Error(`Scene ${index + 1} must start at ${expectedStart}s for the selected ${sceneDuration}s timing.`);
    const length = end - start;
    if (index < exactSource.length - 1 && Math.abs(length - sceneDuration) > 0.01) throw new Error(`Scene ${index + 1} must be exactly ${sceneDuration} seconds.`);
    if (length > sceneDuration + 0.01) throw new Error(`Scene ${index + 1} exceeds ${sceneDuration} seconds.`);
    return { number:index+1,start,end,duration:Number(length.toFixed(3)),text,silent:!text };
  });
  if (!words.length && !exactScenes.length) throw new Error('No timestamped scenes or word-level timestamps were found.');
  const lastTimestamp = exactScenes.at(-1)?.end ?? words.at(-1)!.end;
  const duration = Number(raw.duration ?? raw.result?.duration ?? lastTimestamp);
  if (!finite(duration) || duration <= 0 || (exactScenes.length ? Math.abs(duration - lastTimestamp) > 0.01 : duration < lastTimestamp)) throw new Error('Duration must cover all timestamps and match the end of the final pre-split scene.');
  if (!words.length) exactScenes.filter(scene=>!scene.silent).forEach((scene,index)=>words.push({ text:`${index?' ':''}${scene.text}`, start:scene.start, end:scene.end, probability:1 }));
  const text = String(raw.text ?? raw.result?.text ?? words.map(word => word.text).join('')).replace(/\s+/g,' ').trim();
  return {
    audioFileName: fileName, duration, language: 'en', languageProbability: Number(raw.language_probability ?? raw.languageProbability ?? 1),
    model: String(raw.model || 'external'), computeType: String(raw.compute_type || raw.computeType || 'external'), text, segments, words,
    sceneDurationSeconds: sceneDuration, scenes: exactScenes.length ? exactScenes : buildTimedScenes(words, duration, sceneDuration), importedAt: new Date().toISOString(),
  };
}
