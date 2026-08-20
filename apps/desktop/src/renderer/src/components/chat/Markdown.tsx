import { useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";

import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

type MarkdownExtraProps = { readonly node?: unknown };

function CodeBlock({
  children,
  className,
  node: _node,
  ...props
}: ComponentPropsWithoutRef<"pre"> & MarkdownExtraProps): ReactNode {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  const copy = async (): Promise<void> => {
    const text = preRef.current?.innerText ?? "";
    if (text.length === 0) return;
    if (await copyText(text)) {
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
      }, 2_000);
    }
  };

  return (
    <div className="group relative">
      <pre
        className={cn(
          "overflow-x-auto rounded-lg border bg-muted/50 p-3 font-mono text-[0.8rem] leading-relaxed",
          className,
        )}
        ref={preRef}
        {...props}
      >
        {children}
      </pre>
      <button
        aria-label={copied ? "Code copied" : "Copy code"}
        className="absolute top-2 right-2 rounded-md border bg-background/80 p-1.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-foreground"
        onClick={() => void copy()}
        type="button"
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  );
}

function ExternalLink({
  children,
  href,
  node: _node,
  ...props
}: ComponentPropsWithoutRef<"a"> & MarkdownExtraProps): ReactNode {
  return (
    <a href={href} rel="noreferrer" target="_blank" {...props}>
      {children}
    </a>
  );
}

const BASE_COMPONENTS: Components = {
  a: ExternalLink,
  pre: CodeBlock,
};

interface MarkdownProps {
  readonly children: string;
  readonly className?: string;
  readonly components?: Components;
}

/**
 * Safe markdown rendering: raw HTML in model output is skipped entirely
 * (rendered as nothing, never injected), code blocks get class-based
 * highlighting, and links open externally via the main process.
 */
export function Markdown({ children, className, components }: MarkdownProps): ReactNode {
  return (
    <div className={cn("markdown", className)}>
      <ReactMarkdown
        components={{ ...BASE_COMPONENTS, ...components }}
        rehypePlugins={[rehypeHighlight]}
        remarkPlugins={[remarkGfm]}
        skipHtml
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
