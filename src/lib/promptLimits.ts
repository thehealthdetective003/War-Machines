export const MAX_VIDEO_PROMPT_WORDS = 280;
export const VIDEO_PROMPT_COMPACTION_TARGET = 270;

export const countPromptWords = (value: string): number => value.trim().split(/\s+/).filter(Boolean).length;
