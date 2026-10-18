// A local stand-in for Cloudflare's https://challenges.cloudflare.com/turnstile/v0/api.js,
// which test/e2e/turnstile.ts serves in its place, so the end-to-end tests
// never reach Cloudflare. It does what the widget of src/components/
// TurnstileWidget.astro needs, the way Turnstile does it with a test site key:
// `render` adds the hidden field `cf-turnstile-response` to the container and,
// once solved, fills it with the dummy token and calls `callback`; `reset`
// empties it and solves again; and api.js calls the function its `onload`
// parameter names. Every render is recorded in `window.__turnstileRenders`.
// With SOLVE "manual" a test solves the widgets with `window.__turnstileSolve()`.
(() => {
  const SOLVE = "__SOLVE__";
  const TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
  const script = document.currentScript;
  const onload = script ? new URL(script.src).searchParams.get("onload") : null;
  const widgets = new Map();
  window.__turnstileRenders = [];

  const solve = (widget) => {
    widget.input.value = TOKEN;
    widget.options.callback?.(TOKEN);
  };
  const later = (widget) => {
    if (SOLVE === "auto") setTimeout(() => solve(widget), 50);
  };

  window.__turnstileSolve = () => widgets.forEach(solve);
  window.turnstile = {
    render(container, options) {
      const id = `fake-${widgets.size + 1}`;
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = options["response-field-name"] ?? "cf-turnstile-response";
      container.append(input);
      const widget = { input, options };
      widgets.set(id, widget);
      window.__turnstileRenders.push({
        sitekey: options.sitekey,
        action: options.action,
        language: options.language,
        size: options.size,
      });
      later(widget);
      return id;
    },
    reset(id) {
      const widget = widgets.get(id);
      if (!widget) return;
      widget.input.value = "";
      later(widget);
    },
    remove(id) {
      widgets.get(id)?.input.remove();
      widgets.delete(id);
    },
    getResponse(id) {
      return widgets.get(id)?.input.value;
    },
  };
  if (onload && typeof window[onload] === "function") window[onload]();
})();
