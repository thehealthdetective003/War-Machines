import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

interface Props {summary?:string;children:ReactNode;defaultOpen?:boolean;className?:string;}

export function AdvancedDetails({summary='Advanced details',children,defaultOpen=false,className=''}:Props){
  return <details defaultOpen={defaultOpen} className={`advanced-details group rounded-xl border border-border/60 bg-background/35 ${className}`}>
    <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40">
      <span>{summary}</span><ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180"/>
    </summary>
    <div className="border-t border-border/50 p-3">{children}</div>
  </details>;
}
