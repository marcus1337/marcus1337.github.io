// Only posts with `mermaid: true` include this module. It stays active across
// Astro navigation, while the library is loaded only when a diagram is present.
let library;
let activeContext = null;
let pending = Promise.resolve();
let pageSequence = 0;
let renderSequence = 0;

const themeObserver = new MutationObserver(() => {
  if (activeContext) requestRender(activeContext);
});

function isCurrent(context) {
  return activeContext === context && context.root?.isConnected;
}

function deactivate() {
  themeObserver.disconnect();
  if (activeContext) {
    activeContext.root = null;
    activeContext.diagrams = [];
  }
  activeContext = null;
}

function loadLibrary() {
  library ??= import(
    'https://cdn.jsdelivr.net/npm/mermaid@12.1.0/dist/mermaid.esm.min.mjs'
  ).then(({ default: mermaid }) => mermaid).catch((error) => {
    library = undefined;
    throw error;
  });
  return library;
}

async function renderDiagrams(context) {
  if (!isCurrent(context)) return;
  const mermaid = await loadLibrary();
  if (!isCurrent(context)) return;

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: document.documentElement.dataset.theme === 'light' ? 'default' : 'dark',
    fontFamily: 'system-ui, sans-serif',
  });

  for (const [index, diagram] of context.diagrams.entries()) {
    if (!isCurrent(context)) return;
    try {
      const valid = await mermaid.parse(diagram.source, { suppressErrors: true });
      if (!isCurrent(context)) return;
      if (!valid) {
        if (diagram.details) diagram.details.open = true;
        continue;
      }

      // Each render gets a new ID, including theme changes and repeat visits.
      const id = `blog-diagram-${context.id}-${index}-${++renderSequence}`;
      const { svg } = await mermaid.render(id, diagram.source);
      if (!isCurrent(context)) return;

      if (!diagram.graph) {
        const figure = document.createElement('figure');
        figure.className = 'mermaid-figure';
        figure.setAttribute('aria-label', `Diagram ${index + 1}`);
        diagram.graph = document.createElement('div');
        diagram.graph.className = 'mermaid-graph';
        diagram.details = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = 'Diagram source';
        diagram.block.before(figure);
        diagram.details.append(summary, diagram.block);
        figure.append(diagram.graph, diagram.details);
      }

      // Strict Mermaid output encodes diagram HTML and disables clickable actions.
      diagram.graph.innerHTML = svg;
    } catch (error) {
      if (!isCurrent(context)) return;
      if (diagram.details) diagram.details.open = true;
      console.warn('Diagram could not be rendered; source is still available.', error);
    }
  }
}

function requestRender(context) {
  if (!isCurrent(context) || context.queued) return;
  context.queued = true;
  // One queue covers every page and theme, so Mermaid renders never overlap.
  pending = pending.then(async () => {
    context.queued = false;
    await renderDiagrams(context);
  }).catch((error) => {
    if (isCurrent(context)) {
      console.warn('Mermaid could not render; showing diagram source instead.', error);
    }
  });
}

function initializePage() {
  const root = document.querySelector('.post-body[data-mermaid-enabled]');
  if (root && activeContext?.root === root) return;
  deactivate();
  if (!root) return;

  // Astro/Shiki supplies data-language; the class supports plain HTML too.
  const diagrams = [...root.querySelectorAll(
    'pre[data-language="mermaid"] code, code.language-mermaid'
  )].map((code) => ({
    source: code.textContent ?? '',
    block: code.closest('pre'),
    graph: null,
    details: null,
  })).filter((diagram) => diagram.block);
  if (!diagrams.length) return;

  activeContext = { root, diagrams, id: ++pageSequence, queued: false };
  themeObserver.observe(document.documentElement, {
    attributes: true, attributeFilter: ['data-theme'],
  });
  requestRender(activeContext);
}

document.addEventListener('astro:before-swap', deactivate);
document.addEventListener('astro:page-load', initializePage);
initializePage();
