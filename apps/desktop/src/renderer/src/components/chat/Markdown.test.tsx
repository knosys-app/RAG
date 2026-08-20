import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { Markdown } from "@/components/chat/Markdown";

afterEach(cleanup);

describe("Markdown", () => {
  it("renders raw HTML from model output as inert text, never as elements", () => {
    const { container } = render(
      <Markdown>
        {'Before <script>window.alert("x")</script> <img src="x" onerror="window.alert(1)" /> after'}
      </Markdown>,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("Before");
    expect(container.textContent).toContain("after");
  });

  it("renders GFM tables and fenced code with a copy button", () => {
    const { container } = render(
      <Markdown>
        {"| a | b |\n| - | - |\n| 1 | 2 |\n\n```ts\nconst x = 1;\n```"}
      </Markdown>,
    );
    expect(container.querySelector("table")).toBeTruthy();
    expect(container.querySelector("pre code")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy code" })).toBeTruthy();
  });

  it("opens links externally", () => {
    const { container } = render(<Markdown>{"[docs](https://example.com)"}</Markdown>);
    const link = container.querySelector("a");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noreferrer");
  });
});
