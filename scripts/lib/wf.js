// Utilidades compartidas por los generadores de workflows (estilo visual y documentación uniformes).
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// Rejilla de n8n: 20 px. Columnas y filas fijas para que todo quede alineado.
const GRID = 20;
const snap = (v) => Math.round(v / GRID) * GRID;

// Colores de sticky notes en n8n (1 amarillo, 2 naranja, 3 rojo, 4 verde, 5 azul, 6 morado, 7 gris)
const COLOR = { header: 5, trigger: 7, input: 6, transform: 4, output: 2, alert: 3 };

function sticky(id, content, [x, y], [w, h], color) {
  return {
    id: `note-${id}`, name: `Note ${id}`, type: 'n8n-nodes-base.stickyNote', typeVersion: 1,
    position: [snap(x), snap(y)], parameters: { content, width: snap(w), height: snap(h), color },
  };
}

// Añade documentación visible bajo el nodo (Settings → Notes + "Display note in flow").
function doc(node, note) {
  node.position = node.position.map(snap);
  node.notes = note;
  node.notesInFlow = true;
  return node;
}

function connector() {
  const connections = {};
  const link = (from, to) => {
    (connections[from] ??= { main: [[]] }).main[0].push({ node: to, type: 'main', index: 0 });
  };
  return { connections, link };
}

// Claves ordenadas (igual que `jq -S` en scripts/n8n.sh pull) para diffs estables en git.
const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v;

function writeWorkflow(file, workflow) {
  const names = workflow.nodes.map((n) => n.name);
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) throw new Error(`Nombre de nodo repetido: ${dup}`);
  for (const [from, c] of Object.entries(workflow.connections)) {
    for (const t of [from, ...c.main.flat().map((x) => x.node)]) {
      if (!names.includes(t)) throw new Error(`Conexión a un nodo inexistente: ${t}`);
    }
  }
  const out = path.join(ROOT, file);
  fs.writeFileSync(out, JSON.stringify(sortKeys(workflow), null, 2) + '\n');
  const real = workflow.nodes.filter((n) => !n.type.endsWith('stickyNote')).length;
  console.log(`OK → ${file} (${real} nodos + ${workflow.nodes.length - real} notas)`);
}

module.exports = { ROOT, read, GRID, snap, COLOR, sticky, doc, connector, writeWorkflow };
