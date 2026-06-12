import ReactMarkdown from "react-markdown";

// お知らせ本文の Markdown 表示。react-markdown は既定で生 HTML を描画しないため安全。
export function Markdown({ children }: { children: string }) {
  return (
    <div className="text-sm leading-relaxed text-ink">
      <ReactMarkdown
        components={{
          h1: ({ children }) => <h1 className="mb-2 mt-3 text-base font-bold">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-1.5 mt-3 text-sm font-bold">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-1 mt-2 text-sm font-semibold">{children}</h3>,
          p: ({ children }) => <p className="my-2 whitespace-pre-wrap">{children}</p>,
          ul: ({ children }) => <ul className="my-2 list-disc pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal pl-5">{children}</ol>,
          li: ({ children }) => <li className="my-0.5">{children}</li>,
          a: ({ href, children }) => (
            <a href={href} className="text-gold-600 underline" target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          strong: ({ children }) => <strong className="font-bold">{children}</strong>,
          code: ({ children }) => (
            <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-xs">{children}</code>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
