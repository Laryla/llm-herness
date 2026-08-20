import { memo } from "react";
import Markdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

/** 模型输出的统一安全 Markdown 视图；不解析模型返回的原始 HTML。 */
export const MarkdownContent = memo(function MarkdownContent({ content }: { content: string }) {
  return <div className="markdown-content"><Markdown
    components={{
      a: ({ children, href }) => <a href={href} rel="noreferrer" target="_blank">{children}</a>,
    }}
    remarkPlugins={[remarkGfm, remarkBreaks]}
    skipHtml
  >{content}</Markdown></div>;
});
