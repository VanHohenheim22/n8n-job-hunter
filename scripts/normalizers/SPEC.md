# Normalizadores de ofertas (Workflow 1)

Objetivo: funciones JS puras que conviertan la respuesta CRUDA de cada fuente en una lista de ofertas con
un formato común. Se pegarán tal cual dentro de nodos "Code" de n8n, así que:

- JavaScript plano, SIN `require`/`import`, SIN dependencias, SIN acceso a red, fs ni variables de entorno.
- Cada archivo `<fuente>.js` define UNA función `normalize<Fuente>(body)` (`body` = string con la respuesta cruda)
  y al final: `if (typeof module !== 'undefined') module.exports = { normalize<Fuente> };`
- Tolerante a errores: un registro malo se omite (no lanza excepción). Respuesta vacía o inválida → `[]`.

## Archivos a crear
- `remoteok.js`  → `normalizeRemoteok(body)`  (JSON array; el elemento 0 es un aviso legal sin `id`: ignorarlo)
- `remotive.js`  → `normalizeRemotive(body)`  (JSON `{ jobs: [...] }`)
- `wwr.js`       → `normalizeWwr(body)`       (RSS XML; parsear `<item>` con regex/strings, sin librerías.
                                              Decodificar entidades HTML (&amp; &lt; &gt; &quot; &#39; &#NNN;) y CDATA)
- `common.js`    → helpers compartidos (`stripHtml`, `decodeEntities`, `toIso`, `parseSalary`, `clean`).
                   Como en n8n no hay require, cada `<fuente>.js` debe funcionar SOLO: duplica ahí los helpers
                   que necesite (common.js es solo referencia). Mantén los helpers idénticos entre archivos.
- `test.js`      → pruebas con `node:test` + `node:assert` usando `fixtures/`. Ejecutar: `node --test scripts/normalizers/`

## Formato de salida (cada oferta)
| campo | tipo | notas |
|---|---|---|
| source | string | `remoteok` / `remotive` / `wwr` |
| source_id | string | remoteok: `id`; remotive: `id`; wwr: `<guid>` (o `<link>` si falta) |
| url | string | remoteok: `url`; remotive: `url`; wwr: `<link>` |
| title | string | wwr: el título viene como "Empresa: Puesto" → separar en company/title por el PRIMER ": " |
| company | string\|null | |
| location | string\|null | remoteok: `location`; remotive: `candidate_required_location`; wwr: `<region>` + `<country>` si existe. "" → null |
| tags | string[] | minúsculas, sin espacios extremos, sin duplicados. wwr: `<skills>` separado por "," y " and " |
| category | string\|null | remotive: `category`; wwr: `<category>`; remoteok: null |
| job_type | string\|null | remotive: `job_type`; wwr: `<type>`; remoteok: null. Normalizar a minúsculas con guion: "full_time"/"Full-Time" → "full-time" |
| salary_min, salary_max | integer\|null | remoteok: `salary_min/max` (0 → null). remotive: parsear texto libre `salary` ("$35,3k- $52k" → 35300, 52000; "$60,000 - $80,000" → 60000, 80000; si no se entiende → null, null). wwr: null |
| salary_currency | string\|null | "USD" si hay salario con "$" o es remoteok con salario; si no, null |
| published_at | string\|null | ISO 8601 UTC (`new Date(x).toISOString()`). remotive viene sin zona → asumir UTC. wwr: `<pubDate>` |
| description | string\|null | HTML → texto plano, espacios colapsados, máximo 20000 caracteres |
| raw | object | el registro original SIN `description` (HTML) ni logos (wwr: campos del item como strings) |

## Pruebas mínimas
- Cada fuente: número de ofertas esperado según el fixture (remoteok: 3, remotive: 3, wwr: 4).
- Todos los campos obligatorios (source, source_id, url, title) no vacíos; published_at es ISO válido.
- Casos unitarios de `parseSalary` (los ejemplos de arriba + "Competitive" → null) y de `decodeEntities`.
- wwr: "Pavago: SEO &amp; Digital Marketing Specialist" → company "Pavago", title "SEO & Digital Marketing Specialist".
- Entrada vacía / basura → `[]` sin excepción.

---

# Fuentes nuevas (2026-11-13)

Mismas reglas que arriba (JS plano autocontenido, helpers copiados IDÉNTICOS de `common.js`, incluido `slimRaw`
si aplica, sin require/red/fs/env, tolerante a errores). Toma `remoteok.js` y `wwr.js` como modelo de estilo.

## `getonbrd.js` → `normalizeGetonbrd(body)`
Entrada: JSON `{ data: [ { id, type, attributes: {...}, links: { public_url } } ], meta }` (API v0 de GetOnBrd; el WF pide además `location_tenants` y `location_regions` expandidos → location "Remote (Chile, Colombia)"
con `expand=["company","tags","seniority","modality"]`; ver `fixtures/getonbrd.json`).
- **Solo ofertas remotas**: `attributes.remote_modality` ∈ {`fully_remote`, `remote_local`}. Las demás se omiten.
- source `getonbrd`; source_id = `id`; url = `links.public_url`; title = `attributes.title`
- company = `attributes.company.data.attributes.name`
- location: `fully_remote` → "Remote (worldwide)"; `remote_local` → "Remote (" + countries.join(", ") + ")",
  pero si countries es vacío o solo ["Remote"] → "Remote (local)".
- tags = nombres de `attributes.tags.data[].attributes.name` (minúsculas, únicos)
- category = `attributes.category_name`; job_type = nombre de `attributes.modality.data.attributes.name` normalizado
  (minúsculas, espacios/guiones bajos → "-"), o null.
- **Salario**: `min_salary`/`max_salary` son MENSUALES en USD → guardar ANUAL (× 12). Si uno solo existe, usarlo en ambos.
  salary_currency "USD" si hay salario. null si no hay.
- published_at: `attributes.published_at` es epoch en SEGUNDOS → ISO.
- description: concatenar HTML de `description`, `functions`, `desirable`, `benefits` (los que existan, separados
  por un salto) → stripHtml (máx 20000).
- raw: el objeto `attributes` SIN `description`, `functions`, `desirable`, `benefits`, `projects`, ni los `*_headline`,
  y con `company`, `tags`, `seniority`, `modality` reducidos a su nombre (string) para ahorrar espacio.
  Añadir a raw `seniority_name` y `lang` (ya viene). Mantener `min_salary`/`max_salary` originales (mensuales).

## `n8nforum.js` → `normalizeN8nforum(body)`
Entrada: RSS de Discourse (`fixtures/n8nforum.xml`), mismo estilo de parseo que `wwr.js`.
- source `n8nforum`; source_id = número de tema extraído de `<guid>` ("community.n8n.io-topic-328131" → "328131");
  si no se puede, el `<link>`. url = `<link>`.
- title = `<title>` decodificado (NO separar por ": "). company = null.
- location = null; category = `<category>`; job_type: si el título contiene (sin distinguir mayúsculas)
  "full-time"/"full time" → "full-time", "part-time"/"part time" → "part-time", "freelance" → "freelance",
  "contract" → "contract"; si no, null. (el primero que aparezca en ese orden)
- tags = []; salario: null (texto libre; se extraerá después).
- published_at = `<pubDate>` → ISO. description = stripHtml(`<description>`).
- Omitir ítems con `<discourse:topicPinned>Yes` o `<discourse:topicArchived>Yes`. (NO filtrar `topicClosed`: el foro cierra todas las ofertas.)
- raw: `{ guid, link, pubDate, creator, category }` como strings (`<dc:creator>` puede venir en CDATA).

## Pruebas (añadir a `test.js`, sin borrar las existentes)
- getonbrd: el fixture tiene 6 ofertas → salen 4 (2 fully_remote + 2 remote_local); salario de "AI Engineer"
  = 5000×12 = 60000 (min); published_at ISO válido; raw sin `description`; tags no vacíos.
- n8nforum: 5 ítems → 5 ofertas; source_id numérico; títulos con "&amp;" decodificados; la oferta cuyo título
  contiene "Full-Time" tiene job_type "full-time" (si existe en el fixture; si no, prueba unitaria con XML mínimo).
- Entrada vacía/basura → [] en ambas.
