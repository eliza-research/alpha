import type {ReactNode} from 'react';
/** Status is a dot and one word, never colour alone (WCAG 1.4.1). */
export type StatusTone='ok'|'warn'|'err'|'off'|'busy';
export function StatusDot({tone,children}:{tone:StatusTone;children:ReactNode}){
 return <span className="alpha-status" data-tone={tone}><span className="alpha-status-dot" aria-hidden="true"/>{children}</span>;
}
/** A spinner in place of "Checking…" text. The label stays for screen readers. */
export function Busy({label}:{label:string}){
 return <><span className="alpha-spin" aria-hidden="true"/><span className="alpha-sr">{label}</span></>;
}
