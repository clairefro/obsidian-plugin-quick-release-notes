const { Plugin, requestUrl } = require("obsidian");

const COMMUNITY_LIST_URL =
  "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json";

module.exports = class ReleaseNotesLink extends Plugin {
  async onload() {
    this.repos = {}; // plugin id -> "owner/repo"
    this.pendingId = null;
    this.pendingTimer = null;

    // Fetch the official community plugin list (id -> repo)
    try {
      const res = await requestUrl({ url: COMMUNITY_LIST_URL });
      for (const p of res.json) this.repos[p.id] = p.repo;
    } catch (e) {
      console.error(
        "[Quick Release Notes] couldn't load community plugin list",
        e,
      );
    }

    // 1. Remember which plugin's three-dot button was just clicked
    this.registerDomEvent(
      document,
      "click",
      (evt) => {
        const target = evt.target;
        if (!(target instanceof HTMLElement)) return;
        const row = target.closest(".setting-item");
        if (!row || !target.closest(".clickable-icon")) return;

        const nameEl = row.querySelector(".setting-item-name");
        const text = nameEl ? nameEl.textContent.trim() : "";
        if (!text) return;

        // Match the row's displayed name to an installed plugin manifest
        // (longest match wins, since the name may be followed by a version)
        let best = null;
        for (const m of Object.values(this.app.plugins.manifests)) {
          if (
            text.startsWith(m.name) &&
            (!best || m.name.length > best.name.length)
          ) {
            best = m;
          }
        }
        this.pendingId = best ? best.id : null;
        clearTimeout(this.pendingTimer);
        this.pendingTimer = setTimeout(() => (this.pendingId = null), 1000);
      },
      true,
    );

    // 2. When a menu pops up right after, inject our item
    this.observer = new MutationObserver((mutations) => {
      for (const mut of mutations) {
        for (const node of mut.addedNodes) {
          if (node instanceof HTMLElement && node.classList.contains("menu")) {
            this.injectItem(node);
          }
        }
      }
    });
    this.observer.observe(document.body, { childList: true });
  }

  injectItem(menuEl) {
    const id = this.pendingId;
    if (!id) return;
    const repo = this.repos[id];
    if (!repo) return;

    const items = Array.from(menuEl.querySelectorAll(".menu-item"));
    const anchor = items.find(
      (el) => el.textContent.trim() === "Open community page",
    );
    if (!anchor) return; // not the plugin menu

    const item = createDiv({ cls: "menu-item" });
    item.createDiv({ cls: "menu-item-icon" });
    item.createDiv({ cls: "menu-item-title", text: "View release notes" });
    item.addEventListener("click", () => {
      window.open(`https://github.com/${repo}/releases`);
      // Close the menu
      document.body.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true }),
      );
      menuEl.remove();
    });

    anchor.after(item);
    this.pendingId = null;
  }

  onunload() {
    if (this.observer) this.observer.disconnect();
    clearTimeout(this.pendingTimer);
  }
};
