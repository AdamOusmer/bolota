// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

/** Wires every `[data-copy]` button to copy its `data-copy` value (or, absent
 * that, its code-block sibling's text) to the clipboard, with a 2s "copied"
 * flash. Pattern from adam-ousmer.dev's `copy-code.js`. */
export function setupCopyButtons(root: ParentNode = document) {
  root.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((btn) => {
    if (btn.dataset.copyReady === "true") return;
    btn.dataset.copyReady = "true";

    btn.addEventListener("click", async () => {
      const explicit = btn.getAttribute("data-copy");
      const text = explicit && explicit.length ? explicit : (btn.closest(".code-block")?.querySelector("code")?.textContent ?? "");
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        return;
      }
      btn.classList.add("is-copied");
      const label = btn.querySelector(".copy-btn__label");
      const prev = label?.textContent;
      if (label) label.textContent = "copied";
      setTimeout(() => {
        btn.classList.remove("is-copied");
        if (label && prev) label.textContent = prev;
      }, 1600);
    });
  });
}
