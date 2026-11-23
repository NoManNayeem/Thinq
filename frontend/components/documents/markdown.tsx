import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders a document's Markdown with the app's type scale. Raw HTML in documents is
 * never rendered (`skipHtml`), and react-markdown drops unsafe link protocols.
 */
const components: Components = {
  // A document's own headings sit one level below the page title (the page's only h1).
  h1: ({ children }) => <h2 className="mb-4 font-semibold text-xl tracking-tight">{children}</h2>,
  h2: ({ children }) => <h3 className="mt-8 mb-4 font-semibold text-lg">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-6 mb-2 font-semibold text-base">{children}</h4>,
  h4: ({ children }) => <h5 className="mt-6 mb-2 font-semibold text-sm">{children}</h5>,
  p: ({ children }) => <p className="mb-4 text-base">{children}</p>,
  ul: ({ children }) => <ul className="mb-4 flex list-disc flex-col gap-2 pl-6 text-base">{children}</ul>,
  ol: ({ children }) => <ol className="mb-4 flex list-decimal flex-col gap-2 pl-6 text-base">{children}</ol>,
  li: ({ children }) => <li className="pl-1">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  a: ({ children, href }) => (
    <a
      href={href}
      className="text-link underline underline-offset-4"
      rel="noopener noreferrer nofollow"
      target="_blank"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-4 border-border border-l-4 pl-4 text-muted-foreground">{children}</blockquote>
  ),
  code: ({ children }) => <code className="rounded-sm bg-muted px-1 font-mono text-sm">{children}</code>,
  pre: ({ children }) => (
    <pre className="mb-4 overflow-x-auto rounded-lg bg-muted p-4 text-sm">{children}</pre>
  ),
  hr: () => <hr className="my-8" />,
  table: ({ children }) => (
    <div className="mb-4 overflow-x-auto rounded-lg border">
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted">{children}</thead>,
  th: ({ children }) => <th className="px-4 py-2 font-medium">{children}</th>,
  td: ({ children }) => <td className="border-t px-4 py-2 align-top">{children}</td>,
};

export function DocumentMarkdown({ content }: { content: string }) {
  return (
    <div className="min-w-0 break-words" data-testid="document-content">
      <Markdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
        {content}
      </Markdown>
    </div>
  );
}
