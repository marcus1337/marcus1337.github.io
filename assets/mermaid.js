// Only posts with `mermaid: true` load this module. Keep source text as a fallback.
const blocks = [...document.querySelectorAll(
  '.post-body .language-mermaid code, .post-body code.language-mermaid'
)];

if (blocks.length) {
  try {
    const { default: mermaid } = await import(
      'https://cdn.jsdelivr.net/npm/mermaid@12.1.0/dist/mermaid.esm.min.mjs'
    );
    const colorScheme = window.matchMedia('(prefers-color-scheme: dark)');
    const diagrams = blocks.map((code, index) => ({
      source: code.textContent,
      block: code.closest('.highlighter-rouge') || code.closest('pre'),
      id: `blog-diagram-${index}`,
      graph: null,
      details: null
    }));

    async function renderDiagrams() {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: colorScheme.matches ? 'dark' : 'default',
        fontFamily: 'system-ui, sans-serif'
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

          // Mermaid returns sanitized SVG with securityLevel set to strict.
          diagram.graph.innerHTML = svg;
        } catch (error) {
          if (diagram.details) diagram.details.open = true;
          console.warn('Diagram could not be rendered; source is still available.', error);
        }
      }
    }

    await renderDiagrams();
    colorScheme.addEventListener('change', renderDiagrams);
  } catch (error) {
    console.warn('Mermaid could not load; showing diagram source instead.', error);
  }
}
