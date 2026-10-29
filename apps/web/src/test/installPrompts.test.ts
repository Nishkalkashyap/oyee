import { describe, expect, it } from "vitest";
import readme from "../../../../README.md?raw";
import { INSTALL_PROMPTS } from "../lib/installPrompts";

describe("INSTALL_PROMPTS", () => {
  it.each(INSTALL_PROMPTS)("$id prompt matches README.md", ({ prompt }) => {
    expect(readme).toContain("```text\n" + prompt + "\n```");
  });
  it("verifies checksums and pairs afterwards", () => {
    for (const { prompt } of INSTALL_PROMPTS) {
      expect(prompt).toContain("SHA256SUMS.txt");
      expect(prompt).toContain("Pair a device");
    }
  });
});
