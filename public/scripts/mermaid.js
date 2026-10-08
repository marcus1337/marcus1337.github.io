// The post layout includes this module only for posts with `mermaid: true`.
// Astro/Shiki supplies data-language; the class fallback also supports plain HTML.
const blocks = [...document.querySelectorAll(
  '.post-body pre[data-language="mermaid"] code, .post-body code.language-mermaid'
)];

if (blocks.length) {
  try {
    const { default: mermaid } = await import(
      'https://cdn.jsdelivr.net/npm/mermaid@12.1.0/dist/mermaid.esm.min.mjs'
    );
    const isDark = () => document.documentElement.dataset.theme !== 'light';
    const diagrams = blocks.map((code, index) => ({
      source: code.textContent,
      block: code.closest('pre'),
      id: `blog-diagram-${index}`,
      graph: null,
      details: null,
    }));

    async function renderDiagrams() {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: isDark() ? 'dark' : 'default',
        fontFamily: 'system-ui, sans-serif',
      });
      for (const diagram of diagrams) {
        try {
          if (!await mermaid.parse(diagram.source, { suppressErrors: true })) continue;
          const { svg } = await mermaid.render(diagram.id, diagram.source);
          if (!diagram.graph) {
            const figure = document.createElement('figure');
            figure.className = 'mermaid-figure';
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
          if (diagram.details) diagram.details.open = true;
          console.warn('Diagram could not be rendered; source is still available.', error);
        }
      }
    }

    // Serialize theme changes so Mermaid never renders the same ID concurrently.
    let pending = Promise.resolve();
    const update = () => {
      pending = pending.then(renderDiagrams).catch((error) => {
        console.warn('Diagram rendering failed; showing source instead.', error);
      });
      return pending;
    };
    new MutationObserver(update).observe(document.documentElement, {
      attributes: true, attributeFilter: ['data-theme'],
    });
    await update();
  } catch (error) {
    console.warn('Mermaid could not load; showing diagram source instead.', error);
  }
}
