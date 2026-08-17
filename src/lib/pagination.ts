export const PROMPT_PAGE_SIZE = 20;

export function promptPageCount(itemCount: number, pageSize = PROMPT_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(itemCount / pageSize));
}

export function clampPromptPage(page: number, itemCount: number, pageSize = PROMPT_PAGE_SIZE): number {
  return Math.min(Math.max(1, Math.floor(page) || 1), promptPageCount(itemCount, pageSize));
}

export function promptPageItems<T>(items: T[], page: number, pageSize = PROMPT_PAGE_SIZE): T[] {
  const safePage = clampPromptPage(page, items.length, pageSize);
  return items.slice((safePage - 1) * pageSize, safePage * pageSize);
}
