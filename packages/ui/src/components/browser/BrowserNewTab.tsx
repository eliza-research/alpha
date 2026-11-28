import { ArrowRight, Search, X } from "lucide-react";
import { useRef, useState } from "react";
import { cn, focusRing } from "../../lib/cn.ts";
import { dockClearance } from "../../lib/styles.ts";
import { Button } from "../Button.tsx";
import { PrivateMark } from "./PrivateMark.tsx";
import { PrivateNotice } from "./PrivateNotice.tsx";

export type BrowserSite = {
  /** The site's host, which names it. */
  host: string;
  /** The site's own color behind its initial; the surface color where it has none. */
  tone?: "ink" | "blue" | "green";
};

export type BrowserNewTabProps = {
  /** Whether the tab is private, which says what it keeps. */
  private?: boolean;
  privateNotice?: string;
  /** Opens the address for typing when no inline submit handler is provided. */
  onSearch?: () => void;
  /** Submits a query or web address typed directly into the Google search box. */
  onSubmit?: (query: string) => void;
  /** Told whenever the search box text changes. */
  onQueryChange?: (query: string) => void;
  /** Refusal message shown below the search box when a submitted address is rejected. */
  refusal?: string;
  /** The sites visited last, newest first. */
  recent?: BrowserSite[];
  /** Opens a recent site. */
  onOpen?: (host: string) => void;
};

const tones = { ink: "bg-foreground text-background", blue: "bg-alpha text-alpha-foreground", green: "bg-call text-alpha-foreground" } as const;

const googleLetters = [
  {
    key: "G",
    tone: "text-primary",
    d: "M35.53 69.36C16.17 69.36 0 53.68 0 34.68 0 15.68 16.17 0 35.53 0c10.69 0 18.31 4.19 24.03 9.65l-6.75 6.75c-4.1-3.85-9.65-6.84-17.28-6.84-14.08 0-25.09 11.35-25.09 25.12s11.01 25.12 25.09 25.12c9.13 0 14.34-3.67 17.67-7 2.73-2.73 4.52-6.66 5.21-12.04H35.53v-9.47h32.26c.34 1.71.51 3.76.51 5.98 0 7.17-1.96 16.05-8.28 22.37-6.15 6.4-14 9.72-24.49 9.72z",
  },
  {
    key: "o1",
    tone: "text-status-error",
    d: "M115.75 47.18c0 12.77-9.99 22.18-22.25 22.18s-22.25-9.41-22.25-22.18C71.25 34.32 81.24 25 93.5 25s22.25 9.32 22.25 22.18zm-9.74 0c0-7.98-5.79-13.44-12.51-13.44S80.99 39.2 80.99 47.18c0 7.9 5.79 13.44 12.51 13.44s12.51-5.55 12.51-13.44z",
  },
  {
    key: "o2",
    tone: "text-status-warn",
    d: "M163.75 47.18c0 12.77-9.99 22.18-22.25 22.18s-22.25-9.41-22.25-22.18c0-12.85 9.99-22.18 22.25-22.18s22.25 9.32 22.25 22.18zm-9.74 0c0-7.98-5.79-13.44-12.51-13.44s-12.51 5.46-12.51 13.44c0 7.9 5.79 13.44 12.51 13.44s12.51-5.55 12.51-13.44z",
  },
  {
    key: "g",
    tone: "text-primary",
    d: "M209.75 26.34v39.82c0 16.38-9.66 23.07-21.08 23.07-10.75 0-17.22-7.19-19.66-13.07l8.48-3.53c1.51 3.61 5.21 7.87 11.17 7.87 7.31 0 11.84-4.51 11.84-13v-3.19h-.34c-2.18 2.69-6.38 5.04-11.68 5.04-11.09 0-21.25-9.66-21.25-22.09 0-12.52 10.16-22.26 21.25-22.26 5.29 0 9.49 2.35 11.68 4.96h.34v-3.61h9.25zm-8.56 20.92c0-7.81-5.21-13.52-11.84-13.52-6.72 0-12.35 5.71-12.35 13.52 0 7.73 5.63 13.36 12.35 13.36 6.63 0 11.84-5.63 11.84-13.36z",
  },
  {
    key: "l",
    tone: "text-status-ok",
    d: "M225 3v65h-9.5V3h9.5z",
  },
  {
    key: "e",
    tone: "text-status-error",
    d: "M262.02 54.48l7.56 5.04c-2.44 3.61-8.32 9.83-18.48 9.83-12.6 0-22.01-9.74-22.01-22.18 0-13.19 9.49-22.18 20.92-22.18 11.51 0 17.14 9.16 18.98 14.11l1.01 2.52-29.65 12.28c2.27 4.45 5.8 6.72 10.75 6.72 4.96 0 8.4-2.44 10.92-6.14zm-23.27-7.98l19.82-8.23c-1.09-2.77-4.37-4.7-8.23-4.7-4.95 0-11.84 4.37-11.59 12.93z",
  },
] as const;

/** The Google wordmark, colored with theme tokens in normal tabs and monochrome in private tabs. */
function GoogleWordmark({ monochrome }: { monochrome: boolean }) {
  return (
    <svg role="img" aria-label="Google" viewBox="0 0 272 92" className="h-11.5 w-auto select-none">
      {googleLetters.map(({ key, tone, d }) => (
        <path key={key} d={d} fill="currentColor" className={monochrome ? "text-foreground" : tone} />
      ))}
    </svg>
  );
}

/** A tab with no page: Google search landing with the wordmark, pill search input, and recent sites. */
export function BrowserNewTab({ private: privateTab = false, privateNotice, onSearch, onSubmit, onQueryChange, refusal, recent = [], onOpen }: BrowserNewTabProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const inline = onSubmit !== undefined;
  const disabled = !inline && onSearch === undefined;
  return (
    <div className={cn(dockClearance, "flex flex-col items-center gap-7 px-6 pt-32")}>
      <GoogleWordmark monochrome={privateTab} />
      {inline ? (
        <form
          role="search"
          aria-label="Search Google"
          onSubmit={(event) => {
            event.preventDefault();
            if (query.trim() !== "") onSubmit(query);
          }}
          className="flex h-14 w-full max-w-md items-center gap-2 rounded-full border border-border bg-background pr-1.5 pl-4.5 shadow-sm transition-shadow focus-within:border-input focus-within:shadow-md has-[>input:focus-visible]:outline-solid has-[>input:focus-visible]:outline-focus has-[>input:focus-visible]:outline-offset-focus has-[>input:focus-visible]:outline-ring dark:bg-secondary dark:shadow-none dark:focus-within:shadow-none"
        >
          <Search aria-hidden className="size-4.5 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="search"
            aria-label="Search Google or type a URL"
            placeholder="Search Google or type a URL"
            enterKeyHint="search"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              onQueryChange?.(event.target.value);
            }}
            className="h-full min-w-0 flex-1 border-0 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:appearance-none"
          />
          {query !== "" && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Clear search"
              className="size-11 shrink-0 rounded-full text-muted-foreground"
              onClick={() => {
                setQuery("");
                onQueryChange?.("");
                inputRef.current?.focus();
              }}
            >
              <X aria-hidden className="size-4" />
            </Button>
          )}
          {query.trim() !== "" && (
            <Button type="submit" size="icon" aria-label="Search" className="size-11 shrink-0 rounded-full">
              <ArrowRight aria-hidden className="size-4.5" />
            </Button>
          )}
        </form>
      ) : (
        <button
          type="button"
          aria-label="Search Google or type a URL"
          onClick={onSearch}
          disabled={disabled}
          className={cn(focusRing, "flex h-14 w-full max-w-md items-center gap-2.5 rounded-full border border-border bg-background px-4.5 text-base text-muted-foreground shadow-sm disabled:opacity-50 dark:bg-secondary dark:shadow-none")}
        >
          <Search aria-hidden className="size-4.5 shrink-0" />
          <span>Search Google or type a URL</span>
        </button>
      )}
      {refusal && <p role="alert" className="-mt-3 max-w-md text-center text-sm text-destructive">{refusal}</p>}
      {privateTab && (
        <PrivateNotice icon={<PrivateMark aria-hidden className="size-4 shrink-0" />} className="-mt-2 flex items-center justify-center gap-2 text-center">
          {privateNotice}
        </PrivateNotice>
      )}
      {recent.length > 0 && (
        <div className="grid w-full max-w-md grid-cols-4 gap-x-2 gap-y-3.5">
          {recent.map((site) => (
            <button key={site.host} type="button" aria-label={site.host} disabled={onOpen === undefined} onClick={() => onOpen?.(site.host)} className={cn(focusRing, "flex min-w-0 flex-col items-center gap-2 rounded-tile disabled:opacity-50")}>
              <span className={`flex size-13.5 items-center justify-center rounded-full font-display text-2xl ${site.tone ? tones[site.tone] : "bg-secondary"}`}>{site.host.charAt(0).toUpperCase()}</span>
              <span className="max-w-full truncate text-2xs text-muted-foreground">{site.host}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
