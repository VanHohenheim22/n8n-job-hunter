-- WF2: clasifica por reglas las ofertas con status 'new' → 'candidate' | 'filtered_out'.
-- Determinista y sin IA. Para reclasificar todo: UPDATE offers SET status='new' WHERE status IN ('candidate','filtered_out') AND notified_at IS NULL;
-- Perfil: n8n/automatización, JS/Node, Java · Colombia (COT) · inglés básico · Junior–Senior.
WITH base AS (
  SELECT o.id, o.title, o.source, o.location, o.published_at, o.tags,
         lower(o.title || ' ' || array_to_string(o.tags, ' ') || ' ' || coalesce(o.description, '')) AS txt,
         coalesce(o.raw->>'lang', '') AS src_lang,
         ' ' || lower(coalesce(o.description, o.title)) || ' ' AS d
  FROM offers o
  WHERE o.status = 'new'
),
f AS (
  SELECT b.*,
    b.txt ~ '\mn8n\M'                                                                                    AS m_n8n,
    -- Automatización: en el título, o herramientas concretas en cualquier parte (no la palabra suelta en la descripción)
    b.title ~* '(automat|integraci|integration|zapier|workflow|\mrpa\M|no[- ]?code|low[- ]?code)'
      OR b.txt ~ '\m(zapier|make\.com|integromat|power automate)'                                       AS m_auto,
    b.tags && '{javascript,typescript,node,nodejs,node.js,react,next.js,nextjs,vue,vue.js}'::text[]
      OR b.title ~* '\m(node|javascript|typescript|full[ -]?stack|react)'                                AS m_js,
    b.tags && '{java,spring,spring boot,springboot}'::text[] OR b.title ~* '\m(java|spring)\M'           AS m_java,
    b.title ~* '\m(ai agents?|agentic|llm|ai automation|chatbots?)\M'                                     AS m_ia,
    -- Región: abierta / LATAM / Colombia explícita
    b.location ~* '(worldwide|anywhere|latam|latin|south america|americas|colombia)'                     AS r_ok,
    b.location IS NULL OR b.location ~* '^remote$' OR b.source = 'n8nforum'                              AS r_unknown,
    b.title ~* '\m(staff|principal|lead|head|director|vp|chief|cto|manager)\M'                           AS too_senior,
    -- Restricción de país escrita en el título aunque location diga "Anywhere"
    b.title ~* '(\mu\.?s\.?a?\.?|united states|canada|\muk\M|europe|\meu\M)[ -]*(based|only)|remote[ -]+(-[ -]*)?(us|usa|canada|uk|europe)\M'
                                                                                                         AS r_title_excl,
    -- Foro n8n: solo pedidos de contratación (fuera "[For Hire]"/"[Available]" y debates)
    b.source = 'n8nforum' AND (
      b.title ~* '(for hire|\[available\]|^available|open to work|my services|portfolio)'
      OR b.title !~* '(hiring|looking for|seeking|need|wanted|paid|job|freelancer|developer|engineer|expert|specialist|builder|consultant|contract|intern|necesito|busco|buscamos|contrat|se paga|pago|proyecto|desarrollador)'
    )                                                                                                    AS not_a_job,
    -- Roles que no son de desarrollo (ventas, socios comerciales)
    b.title ~* '\m(sales|business development|referral|commission|account executive|sdr|partners?|ventas|comercial)\M'
                                                                                                         AS not_dev,
    b.published_at < now() - interval '30 days'                                                          AS too_old,
    -- Idioma: GetOnBrd lo declara a veces; si no, contar palabras frecuentes es/en
    CASE WHEN b.src_lang = 'es' THEN 'es' WHEN b.src_lang = 'en' THEN 'en'
         WHEN regexp_count(b.d, ' (de|la|que|para|los|con|una|experiencia) ')
            > regexp_count(b.d, ' (the|and|to|of|with|for|you|we) ') THEN 'es'
         ELSE 'en' END                                                                                   AS lang,
    b.title ~* 'ingl[eé]s|english|biling'                                                                AS asks_english
  FROM base b
),
s AS (
  SELECT f.*,
    (m_n8n OR m_auto OR m_js OR m_java)                     AS stack_ok,
    (r_ok OR r_unknown) AND NOT r_title_excl               AS region_ok,
      (CASE WHEN m_n8n  THEN 50 ELSE 0 END) + (CASE WHEN m_auto THEN 25 ELSE 0 END)
    + (CASE WHEN m_js   THEN 20 ELSE 0 END) + (CASE WHEN m_java THEN 20 ELSE 0 END)
    + (CASE WHEN m_ia   THEN 10 ELSE 0 END) + (CASE WHEN lang = 'es' AND NOT asks_english THEN 20 ELSE 0 END)
    + (CASE WHEN r_ok   THEN 10 ELSE 0 END)                AS pts,
    array_remove(ARRAY[
      CASE WHEN m_n8n  THEN 'n8n' END, CASE WHEN m_auto THEN 'automatización' END,
      CASE WHEN m_js   THEN 'js/node' END, CASE WHEN m_java THEN 'java' END, CASE WHEN m_ia THEN 'ia/agentes' END,
      CASE WHEN lang = 'es' THEN 'español' ELSE 'inglés' END,
      CASE WHEN asks_english THEN 'pide inglés' END,
      CASE WHEN r_title_excl OR NOT (r_ok OR r_unknown) THEN 'región excluye Colombia'
           WHEN r_ok THEN 'región ok' ELSE 'región sin especificar' END,
      CASE WHEN not_a_job THEN 'no es oferta' END,
      CASE WHEN not_dev THEN 'no es de desarrollo' END,
      CASE WHEN NOT (m_n8n OR m_auto OR m_js OR m_java) THEN 'stack no coincide' END,
      CASE WHEN too_senior THEN 'demasiado senior' END,
      CASE WHEN too_old THEN 'antigua (>30 días)' END
    ], NULL)                                                AS why
  FROM f
),
upd AS (
  UPDATE offers o SET
    status = CASE WHEN s.stack_ok AND s.region_ok AND NOT s.too_senior AND NOT s.too_old AND NOT s.not_a_job AND NOT s.not_dev
                  THEN 'candidate' ELSE 'filtered_out' END,
    score = s.pts, reasons = s.why, lang = s.lang, classified_at = now()
  FROM s WHERE o.id = s.id
  RETURNING o.status
)
SELECT count(*) FILTER (WHERE status = 'candidate') AS candidatas,
       count(*) FILTER (WHERE status = 'filtered_out') AS descartadas
FROM upd;
