// @vitest-environment jsdom

import { fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { useChatAutoScroll } from "../src/domains/conversations/model/use-chat-auto-scroll.js";

function Harness() {
  const [version, setVersion] = useState(0);
  const scrollRef = useChatAutoScroll("conversation_test", version);
  return <><section data-testid="messages" ref={scrollRef}>版本 {version}</section><button onClick={() => setVersion((value) => value + 1)}>追加内容</button></>;
}

describe("useChatAutoScroll", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => 1_000 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 200 });
  });

  it("贴近底部时跟随新内容，用户查看历史时保持当前位置", () => {
    const view = render(<Harness />);
    const messages = view.getByTestId("messages");
    expect(messages.scrollTop).toBe(1_000);

    messages.scrollTop = 100;
    fireEvent.scroll(messages);
    fireEvent.click(view.getByText("追加内容"));
    expect(messages.scrollTop).toBe(100);

    messages.scrollTop = 790;
    fireEvent.scroll(messages);
    fireEvent.click(view.getByText("追加内容"));
    expect(messages.scrollTop).toBe(1_000);
  });
});
