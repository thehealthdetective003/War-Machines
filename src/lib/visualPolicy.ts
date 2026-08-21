import type { VisualFamily } from '../types';

/** Shared classification primitives; final allocation authority lives in visualBalance.ts. */
export const GRAPHIC_VISUAL_FAMILIES = new Set<VisualFamily>(['TECHNICAL_GRAPHIC','MAP_OR_SUPPLY_CHAIN']);

export function graphicNeedScore(text:string,claim=''):number{
  const value=`${text} ${claim}`.toLowerCase();let score=0;
  if(/\b(schematic|diagrammatic|cutaway|cross[ -]?section|exploded view|otherwise invisible|cannot be filmed|not directly visible)\b/.test(value))score+=4;
  if(/\b(hidden|internal|inside|beneath|embedded)\b/.test(value)&&/\b(mechanism|relationship|path|layer|network|linkage|channel|architecture)\b/.test(value))score+=3;
  if(/\b(signal|energy|heat|airflow|force|data|material)\b/.test(value)&&/\b(flow|path|propagat|transfer|travel|connect|distribution)\b/.test(value))score+=3;
  if(/\b(layer|component|mechanical|spatial|structural)\b/.test(value)&&/\b(relationship|interface|alignment|interlock|interaction)\b/.test(value))score+=3;
  if(/\b(compare|comparison|difference|scale|proportion)\b/.test(value)&&/\b(simultaneous|side[ -]?by[ -]?side|relative|ratio|overlay|versus)\b/.test(value))score+=3;
  if(/\b(workers?|technicians?|robots?|machines?|equipment|cranes?|tools?|products?|components?|structures?|assemblies)\b/.test(value)&&/\b(install(?:s|ed|ing)?|assembl(?:e|es|ed|ing)|weld(?:s|ed|ing)?|inspect(?:s|ed|ing)?|measur(?:e|es|ed|ing)|mov(?:e|es|ed|ing)|lift(?:s|ed|ing)?|cut(?:s|ting)?|test(?:s|ed|ing)?|travel(?:s|ed|ing)?|operat(?:e|es|ed|ing)|patrol(?:s|led|ling)?)\b/.test(value))score-=2;
  return score;
}

export const hasStrongGraphicNeed=(text:string,claim='')=>graphicNeedScore(text,claim)>=3;
