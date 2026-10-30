const { Plugin, Menu, Notice, requestUrl } = require("obsidian");

const COMMUNITY_LIST_URL =
  "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json";

// Elements from other windows (e.g. the Settings window) fail `instanceof Element`
// in this window's JS context, so duck-type instead.
const isEl = (n) => !!n && n.nodeType === 1 && typeof n.closest === "function";

module.exports = class ReleaseNotesLink extends Plugin {
  async onload() {
    this.repos = null; // Map of plugin id -> "owner/repo", fetched on first click
    this.lastClick = null; // { id, time }
    this.observers = [];
    this.attachedDocs = new Set();

    // Patch Menu so we can add an item before a menu is shown
    const plugin = this;
    this.origShowAtMouseEvent = Menu.prototype.showAtMouseEvent;
    this.origShowAtPosition = Menu.prototype.showAtPosition;

    Menu.prototype.showAtMouseEvent = function (evt, ...rest) {
      try {
        plugin.augment(this, evt);
      } catch (e) {}
      return plugin.origShowAtMouseEvent.call(this, evt, ...rest);
    };
    Menu.prototype.showAtPosition = function (pos, ...rest) {
      try {
        plugin.augment(this, null);
      } catch (e) {}
      return plugin.origShowAtPosition.call(this, pos, ...rest);
    };

    // Click tracking + DOM observer fallback in every window
    this.attachToWindow(window);
    if (typeof activeWindow !== "undefined" && activeWindow !== window) {
      this.attachToWindow(activeWindow);
    }
    this.registerEvent(
      this.app.workspace.on("window-open", (_ww, win) =>
        this.attachToWindow(win),
      ),
    );
  }

  attachToWindow(win) {
    const doc = win.document;
    if (!doc || this.attachedDocs.has(doc)) return;
    this.attachedDocs.add(doc);

    const remember = (evt) => {
      const t = evt.target;
      if (!isEl(t)) return;
      const row = t.closest(".setting-item");
      if (!row) return;
      const id = this.pluginIdFromRow(row);
      if (id) this.lastClick = { id, time: Date.now() };
    };
    for (const type of ["pointerdown", "mousedown", "click"]) {
      this.registerDomEvent(doc, type, remember, true);
    }

    const observer = new win.MutationObserver((mutations) => {
      for (const mut of mutations) {
        for (const node of mut.addedNodes) {
          if (!isEl(node)) continue;
          const menus = node.classList.contains("menu")
            ? [node]
            : Array.from(node.querySelectorAll(".menu"));
          for (const menuEl of menus) {
            this.domInject(menuEl);
            win.requestAnimationFrame(() => this.domInject(menuEl));
            win.setTimeout(() => this.domInject(menuEl), 50);
          }
        }
      }
    });
    observer.observe(doc.body, { childList: true, subtree: true });
    this.observers.push(observer);
  }

  pluginIdFromRow(row) {
    const nameEl = row.querySelector(".setting-item-name");
    const text = nameEl ? nameEl.textContent.trim() : "";
    if (!text) return null;
    let best = null;
    for (const m of Object.values(this.app.plugins.manifests || {})) {
      if (text.includes(m.name) && (!best || m.name.length > best.name.length))
        best = m;
    }
    return best ? best.id : null;
  }

  resolveTarget(evt) {
    let id = null;
    if (evt && isEl(evt.target)) {
      const row = evt.target.closest(".setting-item");
      if (row) id = this.pluginIdFromRow(row);
    }
    if (!id && this.lastClick && Date.now() - this.lastClick.time < 5000) {
      id = this.lastClick.id;
    }
    return id ? { id } : null;
  }

  // Fetch the community list on first use, then open the plugin's releases page
  async openReleases(id) {
    try {
      if (!this.repos) {
        const res = await requestUrl({ url: COMMUNITY_LIST_URL });
        this.repos = new Map(res.json.map((p) => [p.id, p.repo]));
      }
    } catch (e) {
      new Notice("Couldn't load the community plugin list.");
      return;
    }
    const repo = this.repos.get(id);
    if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
      new Notice("No GitHub repo found for this plugin.");
      return;
    }
    window.open(`https://github.com/${repo}/releases`);
  }

  // Path A: Menu object
  augment(menu, evt) {
    if (menu.__rnlDone) return;
    const items = menu.items || [];
    const idx = items.findIndex(
      (it) =>
        it && it.dom && it.dom.textContent.trim() === "Open community page",
    );
    if (idx < 0) return;
    menu.__rnlDone = true;

    const target = this.resolveTarget(evt);
    if (!target) return;

    // Sit right after "View details" (fall back to "Open community page")
    const detailsIdx = items.findIndex(
      (it) => it && it.dom && it.dom.textContent.trim() === "View details",
    );
    const afterIdx = detailsIdx >= 0 ? detailsIdx : idx;
    const ref = items[afterIdx];

    menu.addItem((item) => {
      item
        .setTitle("View release notes")
        .onClick(() => this.openReleases(target.id));
      // Join the same section/group as the reference item, otherwise the menu
      // puts section-less items at the very end.
      if (ref.section !== undefined && typeof item.setSection === "function") {
        item.setSection(ref.section);
      }
    });

    const added = menu.items.pop();
    menu.items.splice(afterIdx + 1, 0, added);

    // The menu may re-order its DOM when it's shown, so (re)place the element
    // right after the reference item, now and just after rendering.
    const place = () => {
      if (ref.dom && added.dom && ref.dom.isConnected) ref.dom.after(added.dom);
    };
    place();
    setTimeout(place, 0);
    setTimeout(place, 50);
  }

  // Path B: raw DOM fallback
  domInject(menuEl) {
    if (menuEl.dataset.rnlDone) return;
    const itemEls = Array.from(menuEl.querySelectorAll(".menu-item"));
    if (itemEls.some((el) => el.textContent.trim() === "View release notes")) {
      menuEl.dataset.rnlDone = "1";
      return;
    }
    const anchor = itemEls.find(
      (el) => el.textContent.trim() === "Open community page",
    );
    if (!anchor) return;
    menuEl.dataset.rnlDone = "1";

    const target = this.resolveTarget(null);
    if (!target) return;

    const doc = menuEl.ownerDocument;
    const item = doc.createElement("div");
    item.className = "menu-item tappable";
    item.innerHTML =
      '<div class="menu-item-icon"></div><div class="menu-item-title">View release notes</div>';
    item.addEventListener("click", () => {
      this.openReleases(target.id);
      doc.body.dispatchEvent(
        new doc.defaultView.MouseEvent("mousedown", { bubbles: true }),
      );
      menuEl.remove();
    });
    const details = itemEls.find(
      (el) => el.textContent.trim() === "View details",
    );
    (details || anchor).after(item);
  }

  onunload() {
    if (this.origShowAtMouseEvent)
      Menu.prototype.showAtMouseEvent = this.origShowAtMouseEvent;
    if (this.origShowAtPosition)
      Menu.prototype.showAtPosition = this.origShowAtPosition;
    for (const o of this.observers) o.disconnect();
  }
};
