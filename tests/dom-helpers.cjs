exports.installDomHelpers = function(win) {
  const prototype = win.HTMLElement.prototype;
  prototype.createEl = function(tag, options = {}) {
    const element = this.ownerDocument.createElement(tag);
    if (typeof options === "string") element.className = options;
    else {
      if (options.cls) element.className = Array.isArray(options.cls) ? options.cls.join(" ") : options.cls;
      for (const [name, value] of Object.entries(options.attr ?? {})) element.setAttribute(name, String(value));
      if (options.text) element.textContent = options.text;
    }
    this.appendChild(element);
    return element;
  };
  prototype.createDiv = function(options) { return this.createEl("div", options); };
  prototype.createSpan = function(options) { return this.createEl("span", options); };
};
