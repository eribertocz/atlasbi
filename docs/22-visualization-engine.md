# Documento de implementación: Visualization Engine — visualización analítica premium como diferenciador

> **Documento canónico** del Visualization Engine, Visual Intelligence, el Visualization Design System, el Motion System, el Custom Component Studio y el Custom Visual SDK. Otros documentos (`08-frontend.md` §11.7, `18-first-class-citizens.md`, `19-operabilidad-runtime.md` §8.1, `20-product-ui-ux.md` §7, `21-engineering-standards.md` §3) solo lo referencian — la arquitectura vive acá, una sola vez.
>
> **Naturaleza de este documento: dirección arquitectónica y visión de producto, no implementación.** Nada de lo descrito acá entra en el Paso 1 (DuckDB + DuckLake) ni cambia el alcance del MVP (`16-mvp-definicion-terminado.md` §2). ECharts sigue siendo el renderer principal y el camino rápido para avanzar (sección 11).
>
> "AtlasBI" es el codename provisional del producto (`21-engineering-standards.md` §1), no su marca definitiva — los contratos que define este documento (`VisualSpec`, `VisualizationRendererPort`, `CustomComponentManifest`, `ComponentData`) no llevan la marca en su nombre.

---

## 1. Decisión estratégica

**La capa de visualización es uno de los diferenciadores principales de la plataforma frente a Power BI, Tableau y el resto del mercado.** No "BI + ECharts", ni "BI + una librería de charts existente con otro theme": un **Visualization Engine propio**, con contrato propio, identidad visual reconocible y una experiencia moderna, pulida, fluida e interactiva.

Es una **aspiración de producto**, no una afirmación de que hoy ya se supera a Power BI o Tableau. Se vuelve verificable mediante los atributos medibles de la sección 13.

**Posicionamiento.** La ambición diferenciadora combina:

- **premium analytical visualization** (este documento);
- BI *semantic-first* (`04-semantico.md`, `18-first-class-citizens.md` Tier 0);
- *self-service authoring* excelente (`08-frontend.md` §11, `17-self-service-calculations.md`);
- analítica de alto rendimiento (`01-motor-almacenamiento.md`);
- extensibilidad visual extrema (secciones 8–10);
- arquitectura abierta (`21-engineering-standards.md` §3).

El benchmark visual incluye Power BI, Tableau y las mejores librerías modernas de visualización. **El objetivo no es copiarlos** — es una experiencia visual propia, moderna y excepcional (regla 8 de `CLAUDE.md`: ninguna idea externa se adopta en su implementación original).

### 1.1 Principios de identidad

> **Las visualizaciones de la plataforma tienen una identidad de producto reconocible, independiente del renderer que las dibuje.**

> **Las librerías de renderizado son infraestructura. La experiencia de visualización es una capacidad de la plataforma.**

> **Las tecnologías web estándar son una vía de escape de primera clase para creadores avanzados — sin comprometer la seguridad ni las fronteras arquitectónicas.**

> **Un usuario no debería tener que convertirse en diseñador gráfico para crear una visualización analítica hermosa.**

### 1.2 El diferencial no es "tener muchos gráficos"

Competir por cantidad de *chart types* no alcanza. El diferencial es la **combinación**: calidad visual (sección 4), movimiento con significado (sección 5), interacción coherente entre todos los visuales (sección 6), inteligencia de defaults (sección 3), rendimiento (sección 7) y extensibilidad sin romper la experiencia (secciones 8–10).

---

## 2. Arquitectura

```
Semantic Model (capa 4 — medidas, dimensiones, jerarquías, formatos, semántica de negocio)
      ↓
Visual Intelligence  ── sugiere/decide encoding, tipo de visual, formato, interacciones (sección 3)
      ↓
VisualSpec  ── contrato propio, versionado, persistido en `visual.visual_spec` (`19` §8)
      ↓
Visualization Compiler  ── traduce VisualSpec + datos + tema + contexto a un plan de render,
      ↓                    y elige renderer/estrategia según tipo, cardinalidad y capacidades
Visualization Engine
      ↓
┌──────────────────────┬──────────────────────┬──────────────────────┐
│ Business renderer    │ Advanced renderer    │ GPU / GIS renderer   │
│ (hoy: ECharts)       │ (candidato: Vega)    │ (candidato: deck.gl) │
└──────────────────────┴──────────────────────┴──────────────────────┘
      ↓  eventos de interacción normalizados (nunca eventos crudos del renderer)
Interaction Engine (`14-interaction-state-engine.md`)
      ↓
Report / Filter / Drill / Selection
```

### 2.1 Responsabilidades

| Pieza | Responsabilidad | Invariante |
| --- | --- | --- |
| **VisualSpec** | Qué se visualiza: tipo de visual (gramática propia), *data roles* (medidas/dimensiones por rol), encoding, `FormattingSpec`, referencias a `ThemeSpec`, interacciones habilitadas | **Nunca persiste** `EChartsOption`, `VegaSpec`, una `Layer` de deck.gl ni ninguna configuración propietaria de un renderer. Tampoco el nombre del renderer: el tipo de visual es de la plataforma, el renderer lo elige el compilador |
| **Visual Intelligence** | Proponer y completar un `VisualSpec` excelente a partir de metadata semántica | Produce `VisualSpec` — nunca configuración de renderer |
| **Visualization Compiler** | `VisualSpec` + resultado de consulta + tema + contexto (tamaño, DPR, locale, estado de interacción) → plan de render para un adaptador concreto | Único lugar donde se decide qué renderer y qué estrategia de rendimiento usar (sección 7) |
| **Visualization Engine** | Ciclo de vida del render: montar, actualizar, animar (Motion System), dimensionar, liberar | Renderer-agnóstico: habla con los adaptadores solo a través de `VisualizationRendererPort` |
| **Adaptadores de renderer** | Traducir el plan de render a la librería concreta; traducir eventos crudos (click, hover, brush) a eventos de interacción de la plataforma | Los tipos del proveedor nunca cruzan la frontera del adaptador (`21` §3.2) |
| **Interaction Engine** | Semántica de selección, cross-filter, cross-highlight, drill, navegación | **El renderer nunca decide qué significa una interacción** — solo reporta qué marca/miembro se tocó |

### 2.2 `VisualizationRendererPort` y adaptadores

```
VisualizationRendererPort
        ↓
EChartsAdapter        ← hoy: renderer principal (business charts)
MatrixAdapter         ← Matrix Engine (sección 12), TanStack Table + Virtual
VegaAdapter           ← futuro: composiciones declarativas avanzadas
DeckGLAdapter         ← futuro: GPU / geoespacial / volúmenes masivos
FutureNativeRenderer  ← futuro: renderers propios donde generen ventaja competitiva real
```

- **Módulos de D3** (scales, shapes, layouts, interpolación) pueden usarse como librerías **dentro** del compilador o de un adaptador — nunca en un contrato.
- **Negociación de capacidades** (`21` §3.4): el compilador pregunta `renderer.capabilities` (p. ej. `supportsMorphing`, `maxRecommendedMarks`, `gpu`, `svgExport`) — nunca `if (renderer === 'echarts')`.
- **Gobernanza:** Vega/Vega-Lite, deck.gl y D3 son **candidatos**, no adopciones. Cada uno requiere evaluación con la regla 7 de `CLAUDE.md` y una actualización de este documento antes de entrar al stack (regla 5: reemplazar/agregar solo por algo objetivamente mejor para un caso concreto).
- **Contract tests** (`21` §3.3): cada adaptador pasa la misma batería del puerto (render básico, actualización, resize, eventos normalizados, export, accesibilidad mínima).

---

## 3. Visual Intelligence Engine

Capacidad propia de la plataforma, construida sobre el Semantic Model — no un "recomendador de bar vs line".

**Entradas:** metadata semántica (tipo de medida, unidad, moneda, aditividad, jerarquías, cardinalidad estimada, granularidad temporal, calendario fiscal — `04-semantico.md`), forma del resultado, tamaño del contenedor, locale, preferencias del reporte/organización.

**Decide o sugiere:**

| Aspecto | Ejemplos |
| --- | --- |
| Visual adecuado | Métrica + dimensión temporal → línea; métrica + dimensión de baja cardinalidad → barras; parte-del-todo + cardinalidad muy baja → donut/torta cuando corresponde; millones de puntos geoespaciales → estrategia GPU |
| Encoding | Orientación, ordenamiento, eje por defecto, doble eje solo cuando la semántica lo justifica |
| Ejes y escala | Línea base en cero cuando la medida es aditiva; escala log solo con justificación; manejo de outliers |
| Densidad | Cantidad de etiquetas, rotación, truncado, *label collision* |
| Formato | Precisión decimal, moneda, compactación (`287.4M`), unidades — derivados del Semantic Model |
| Color | Paleta categórica/secuencial/divergente según la semántica (p. ej. divergente para variaciones con signo) |
| Leyenda | Posición y visibilidad según espacio y cantidad de series |
| Agregación | Cómo se muestra (totales, promedios, *reference lines*) |
| Tiempo | Granularidad temporal adecuada al rango y al tamaño |
| Responsive | Qué se simplifica al achicar el contenedor |
| Interacciones | Cuáles tienen sentido (brush en series temporales, drill en jerarquías) |

**Reglas:** determinista primero (reglas explícitas, testeables, versionadas); la IA (sección 14) usa Visual Intelligence, no lo reemplaza. El resultado siempre es un `VisualSpec` que el usuario puede ver y modificar.

---

## 4. Visualization Design System

**Distinto del UI Design System** de la aplicación (shadcn-svelte + Tailwind v4, `08-frontend.md` §11.2 y §11.5). Define estándares propios de visualización, expresados como tokens y reglas consumidos por el compilador y por todos los adaptadores:

- tipografía de primer nivel (familias, escala, jerarquía de etiquetas, números tabulares);
- spacing y grids de composición;
- paletas: categórica, semántica (positivo/negativo/neutral/alerta), secuencial, divergente — con verificación de contraste y daltonismo;
- jerarquía de ejes y de grillas;
- anatomía de tooltip, de leyenda y de etiquetas;
- gradientes, sombras y profundidad usados con criterio (nunca por defecto como decoración);
- tiempos de animación y *easing* (sección 5);
- estados: hover, selección, highlight, atenuado, deshabilitado;
- estados de carga, vacío y error;
- accesibilidad, alto contraste, modos claro/oscuro de primer nivel;
- salida *high-DPI*.

Se materializa en `ThemeSpec` + `FormattingSpec` (`19` §8.1, `18` Formatting & Theme Engine): cambiar de renderer nunca destruye el formato de un reporte, porque el formato no vive dentro de ningún renderer.

**Defaults excepcionales.** Cualquier visual creado por defecto ya tiene calidad profesional:

```
Evitar:    crear gráfico → abrir 50 opciones → arreglarlo a mano
Preferir:  datos + semántica → visualización excelente por defecto → personalización profunda si hace falta
```

---

## 5. Motion System

Animaciones propias, coherentes entre visuales y renderers — **para aportar comprensión, no decoración**:

- transiciones de entrada y de actualización (los datos que cambian se ven cambiar);
- transiciones de drill (mantener el contexto al bajar/subir de nivel);
- transiciones de cross-filter y de selección;
- estados de hover;
- *morphing* entre tipos de visual cuando preserva el significado;
- animaciones coordinadas entre visuales de la misma página.

Respeta `prefers-reduced-motion` y tiene **presupuestos**: duración máxima, frames por segundo mínimos, y nunca bloquear la interacción mientras una animación corre.

---

## 6. Interacción unificada

Todas las interacciones se sienten como **una sola plataforma**, sea el visual nativo, un Custom Component o un Custom Visual: hover, selección, multi-selección, brushing, lasso cuando corresponda, zoom, pan, cross-filter, cross-highlight, drill-down, drill-up, expand/collapse, drillthrough, vistas sincronizadas y acciones contextuales.

La semántica vive en el Interaction Engine (`14-interaction-state-engine.md`) y en el Filter Engine (Filter AST). El adaptador solo traduce eventos crudos a eventos de la plataforma (`select(member)`, `hover(member)`, `brush(range)`…).

---

## 7. Rendimiento como atributo premium

Una visualización que se ve bien pero responde lento no es premium. Atributos obligatorios:

- *progressive rendering* y actualizaciones incrementales;
- virtualización cuando aplica (Matrix, tablas, listas largas);
- aceleración GPU donde realmente aporta;
- estrategias para datasets grandes: agregación en el Semantic Model, *downsampling*, *binning*;
- cancelación (alineada con el Query Coordinator, `14` §1.3);
- *hit testing* eficiente;
- presupuestos de animación, memoria y *frame time*.

**El compilador elige la estrategia según cardinalidad y complejidad, sin que el autor rediseñe el visual:**

```
~10k marcas    → renderer normal
~500k marcas   → renderer optimizado / progresivo
~5M marcas     → estrategia GPU
```

(Umbrales ilustrativos — se fijan con benchmarks, sección 13.)

---

## 8. Personalización y extensibilidad — el espectro completo

Premium no significa quitar control. El usuario básico obtiene calidad de inmediato; el avanzado, control profundo:

```
creador normal            → drag & drop, defaults excelentes
creador avanzado          → formato avanzado, Visual Intelligence, temas, formato condicional,
                            reference lines, anotaciones, bandas, etiquetas y tooltips avanzados
diseñador / desarrollador → Custom Component Studio (HTML + CSS + Vanilla JS) — sección 9
ingeniero de visualización → Custom Visual SDK — sección 10
```

### 8.1 Dos niveles de extensibilidad visual — no se mezclan

| | **Custom Component Studio** | **Custom Visual SDK** |
| --- | --- | --- |
| Para qué | Componentes de dashboard: KPI cards, scorecards, headers, paneles, indicadores, storytelling, componentes de marca | Nuevos **tipos de visualización** profundamente integrados (visualización científica, grafos de red, visuales especializados) |
| Tecnología del autor | HTML + CSS + Vanilla JavaScript, sin framework obligatorio | SDK de la plataforma, integrado con el Visualization Engine |
| Relación con `VisualSpec` | Consume datos y tema vía `ComponentData`; su configuración vive en el reporte | Declara nuevos tipos de visual dentro de la gramática de `VisualSpec` |
| Ejemplo | Premium KPI card | Visualización de red especializada |
| Autor típico | Diseñador / desarrollador web del equipo de BI | Ingeniero de visualización |

---

## 9. Custom Component Studio — HTML + CSS + Vanilla JavaScript

### 9.1 Qué es y qué no es

Permite al creador avanzado construir componentes de dashboard completamente personalizados con tecnologías web estándar, con libertad cercana al desarrollo web real **sin salir de la plataforma**:

```
┌─────────────────────────────────────┐
│ ENERGY SALES                        │
│                                     │
│ Bs 287.4M                 ↗ 8.42%  │
│                                     │
│ ▁▂▃▄▅▆▇█                            │
│                                     │
│ Above target by Bs 12.7M            │
└─────────────────────────────────────┘
```

- **No es un "HTML box"** de contenido estático: recibe datos vivos por contrato y participa de las interacciones.
- **No es un runtime de aplicaciones arbitrarias**: existe un Custom Component Runtime con una superficie de API limitada, estable, versionada y segura, solo para componentes de dashboard.

### 9.2 Datos — por contrato, nunca por acceso a internals

```
SemanticQuery (definida por los data roles del manifiesto)
      ↓
Query Coordinator (`14` §1.3) — mismo camino, caché, seguridad y cancelación que un visual nativo
      ↓
ComponentData (contrato público, versionado)
      ↓
Custom Component Runtime (aislado)
      ↓
HTML / CSS / Vanilla JS del autor
```

El componente recibe, mediante APIs públicas y versionadas: `data`, `metadata` (tipos, formatos, unidades), `theme`, `locale`, `formatting`, `selectionState` y `filterContext`. **Nunca** accede a DuckDB, Cube, Postgres ni a APIs internas: los datos ya llegan filtrados por el Security Context del usuario que mira el reporte.

### 9.3 Interacción bidireccional

El componente emite **acciones estandarizadas** hacia el Interaction Engine, y participa exactamente igual que un visual nativo en cross-filter, cross-highlight, drill, navegación, selección, bookmarks e interacciones del reporte:

```
componente
    ↓  select(member) · filter(member) · drill(member) · navigate(page)
    ↓  openTooltip(...) · requestAction(...)
Interaction Engine
```

Ningún componente inventa su propio mecanismo de interacción.

### 9.4 `CustomComponentManifest` (conceptual)

Manifiesto versionado que describe: id, versión, título, descripción, autor, *data roles* requeridos, propiedades configurables, interacciones soportadas, permisos solicitados, versión mínima de plataforma, metadata de accesibilidad y capacidades. **La especificación concreta se decide más adelante** — acá solo se reserva el concepto.

### 9.5 Seguridad — obligatoria desde el diseño

**El JavaScript custom es código no confiable**, aunque lo escriba alguien de la misma organización. Nunca se ejecuta en el contexto privilegiado de la aplicación principal.

- **Aislamiento fuerte**, a evaluar al diseñar el runtime: iframe *sandboxed* (sin `allow-same-origin` hacia la app), CSP estricta, mensajería estructurada (`postMessage` con esquema validado) y una API basada en *capabilities* — contexto de ejecución aislado.
- **Sin acceso** a: la sesión de better-auth, tokens de autenticación, cookies sensibles, Postgres, DuckDB, internals de Cube, filesystem, secretos, el DOM de la aplicación, objetos globales privados ni APIs internas no autorizadas.
- **Red denegada por defecto.** Nada de `fetch` a cualquier URL. Una futura política de permisos/capabilities cubre los casos que realmente necesiten recursos externos, y **los permisos que solicita un componente se conocen antes de ejecutarlo**.
- **Aislamiento de CSS**: un `div { display: none; }` dentro de un componente nunca afecta al resto de la plataforma (iframe, Shadow DOM o estilos con scope, según el runtime elegido).
- Toda capacidad se otorga explícitamente mediante contratos públicos.

### 9.6 Theme tokens

Los componentes consumen *design tokens* oficiales para integrarse con temas claro/oscuro, de organización y de reporte — y pueden optar por un diseño totalmente propio. Ejemplo **ilustrativo**:

```css
var(--atlas-surface)
var(--atlas-text-primary)
var(--atlas-accent)
var(--atlas-radius-lg)
var(--atlas-spacing-md)
```

Esos nombres **no** son la API final. Los tokens, el nombre del objeto de runtime y el protocolo de mensajes son **contratos públicos para terceros**: su nombre definitivo se fija antes de exponerlos, siguiendo la política de naming (`21` §1) — no se congela el codename dentro de una API pública.

### 9.7 Responsive

El componente conoce su contenedor — ancho, alto, *device pixel ratio*, breakpoint — y responde sin depender del layout interno del Report Studio.

### 9.8 Editor (visión futura del Authoring Engine)

```
CUSTOM COMPONENT
┌──────────────┬─────────────────────────────┐
│ HTML         │                             │
│ CSS          │       LIVE PREVIEW          │
│ JavaScript   │                             │
├──────────────┴─────────────────────────────┤
│ Data | Properties | Events | Console       │
└────────────────────────────────────────────┘
```

Editar HTML/CSS/JS, preview inmediato, inspeccionar los datos disponibles, declarar propiedades, probar eventos, usar variables de tema, probar responsive y ver errores de ejecución. El editor concreto se decide más adelante.

### 9.9 Reutilización, distribución y templates

- Ciclo de vida: crear → guardar → versionar → reutilizar en varios reportes → exportar/importar → compartir.
- A futuro: Component Gallery, Organization Library y Community Gallery/Marketplace — **fuera del alcance actual**.
- **Templates premium oficiales**, construidos con este mismo sistema: Executive KPI, Financial KPI, Target vs Actual, Growth Card, Trend Card, SLA Card, Operational Status, Progress Ring, Comparison Card, Narrative Card, Premium Metric Card. El usuario no técnico los usa tal cual; el avanzado los abre, clona y personaliza.

### 9.10 Accesibilidad y export

Cada componente cumple un **contrato mínimo de accesibilidad** (rol, nombre accesible, foco, texto alternativo de su contenido) y declara una **estrategia de export/render** para no desaparecer ni romperse en PNG/PDF (sección 11).

### 9.11 Componentes generados por IA

La IA podrá generar un componente completo (HTML, CSS, JS, manifiesto y *data bindings*) a partir de una descripción — p. ej. *"una card premium para cobrabilidad: porcentaje grande, meta debajo, sparkline de seis meses, estado de alerta bajo 92%"* — pero **siempre** pasando por validación, chequeos de seguridad, sandbox, preview y aprobación del usuario antes de formar parte del reporte. La IA nunca modifica el frontend de la plataforma para crear componentes.

---

## 10. Custom Visual SDK

Para nuevos **tipos de visualización** que se integran al Visualization Engine sin modificar el core (evoluciona la fila "Extensibility / Plugin SDK" de `18`, Tier 3). Se integra con: `VisualSpec`, `SemanticQuery`, Interaction Engine, Theme Engine, Filter Context, Security Context y el contrato de accesibilidad.

**No se aceptan plugins como islas aisladas** que rompan la experiencia: un Custom Visual entra por el mismo contrato que un visual propio, hereda tema, formato, interacción y seguridad, y pasa la misma batería de contract tests que un adaptador (`21` §3.3).

---

## 11. Export / rendering

Capacidad del engine (relación con el Export / Rendering Engine de `18`, Tier 2): PNG, SVG cuando el visual lo permite, PDF/report rendering, export de alta resolución y render *server-side* cuando haga falta. Los Custom Components y Custom Visuals declaran su estrategia de export. Se reserva la arquitectura; no se implementa ahora.

---

## 12. Matrix sigue aparte

El Matrix Engine es un visual *first-class* especializado (`08-frontend.md` §11.6) — nunca "otro chart de ECharts". Comparte con el Visualization Engine: Theme, Formatting, Interaction, Selection, Filter Context y el Report Document Model / `VisualSpec` cuando corresponde; se conecta por `MatrixAdapter`.

---

## 13. "Wow" medible

Las palabras "premium", "hermoso" o "wow" no son criterios. Se traducen a atributos verificables, que más adelante se convierten en **benchmarks, design reviews y criterios de aceptación** (los números se fijan con mediciones reales, no ahora):

| Atributo | Cómo se verificará |
| --- | --- |
| Defaults excelentes | Design review de visuales creados sin tocar formato, sobre datasets de referencia |
| Consistencia visual | Mismo tema/tokens entre visuales nativos, Matrix y Custom Components; regresión visual automatizada |
| Interacción fluida / baja latencia | Latencia p95 de hover, selección y cross-filter (presupuesto a fijar) |
| Transiciones suaves | *Frame time* durante animaciones (presupuesto a fijar); `prefers-reduced-motion` respetado |
| Render responsivo | Tiempo hasta primer render y hasta interactivo por tamaño de dataset |
| Alta densidad sin ruido | Reglas de densidad de etiquetas verificadas por Visual Intelligence |
| Tipografía profesional, colores accesibles | Contraste WCAG y simulación de daltonismo en CI |
| Salida *high-DPI* | Export a 2×/3× sin pérdida |
| Estrategia de millones de puntos | Benchmarks 10k / 500k / 5M marcas con la estrategia elegida por el compilador |
| Interacción coherente entre visuales | Tests de integración del Interaction Engine con visuales nativos y custom |
| Gramática de visualización reutilizable | `VisualSpec` versionado con migraciones (`19` §8.1) |
| Independencia del renderer | Contract tests del `VisualizationRendererPort` para cada adaptador |
| Custom components seguros | Tests de aislamiento (sin acceso a cookies/DOM/red por defecto; CSS contenido) |
| Theming consistente nativo/custom | Mismo tema aplicado a ambos en la regresión visual |

---

## 14. IA + visualización

La IA crea y modifica **contratos de la plataforma validados**, nunca configuración de renderer:

```
"Muéstrame facturación y cobranza por municipio y su evolución mensual"
      ↓
interpretación semántica
      ↓
SemanticQuery
      ↓
Visual Intelligence
      ↓
VisualSpec[]
      ↓
composición profesional del reporte
```

La IA nunca genera `EChartsOption` (ni equivalentes). Mismo principio que rige toda la capa 5 (`05-cerebro-ia.md`): siempre a través del Semantic Model, nunca por fuera.

---

## 15. Relación con ECharts hoy y evolución

ECharts **no se elimina**: sigue siendo el renderer principal, para avanzar rápido con el producto.

```
HOY
VisualSpec → EChartsAdapter → ECharts

DESPUÉS
VisualSpec → Visualization Compiler → ┌ EChartsAdapter ┬ VegaAdapter ┬ DeckGLAdapter ┐

EVENTUALMENTE
renderers propios solo donde generen una ventaja competitiva real
```

**No se inicia una reimplementación completa de Canvas/WebGL desde cero** — retrasaría el producto sin ventaja demostrada. La inversión propia va primero a lo que ninguna librería da: el contrato (`VisualSpec`), Visual Intelligence, el Design System, el Motion System, la interacción unificada y la extensibilidad segura.

---

## 16. Qué es visión y qué queda fuera del alcance actual

**No se implementa en el Paso 1 ni en el MVP:** Visualization Compiler, Visual Intelligence, Vega, deck.gl, D3, Custom Component Studio, Custom Visual SDK, el runtime HTML/CSS/JS y su sandbox, galerías/marketplace, ni frontend relacionado. El MVP sigue saliendo con 2–3 visuales ECharts en modo Viewer (`16` §1).

**Construido en el Paso 6 (`0.6.0`): el primer corte del contrato `VisualSpec`, no del motor.**
- **El contrato:** `VisualSpec` v1 (`19` §8.1), en `@atlasbi/contracts`, con `kind` `kpi`, `bar` o `line`, medidas, dimensiones y `encoding` (categoría y granularidad).
- **Ninguna configuración de renderer se guarda:**
  - el parser rechaza todo campo fuera de la gramática;
  - la base tiene un CHECK con la misma regla;
  - un test confirma que lo que arma el adaptador de ECharts no pasa como spec.
- **El adaptador de ECharts** (`apps/web/src/lib/visualization/echarts/`) es el único código que importa ECharts, por una regla de ESLint. Arma sus opciones al dibujar, a partir de los datos del visual.
- **Lo que todavía no existe:** el Visualization Compiler, el `VisualizationRendererPort` y el Design System.

**Qué hay que diseñar antes de qué:**

| Antes de… | Diseñar |
| --- | --- |
| El Report Builder (Authoring Engine) | `VisualSpec` tipado con gramática propia, `FormattingSpec`/`ThemeSpec` (`19` §8.1), primer corte del Visualization Design System |
| Exponer Custom Components a usuarios | Runtime aislado, modelo de permisos, `CustomComponentManifest`, `ComponentData` versionado, contrato de accesibilidad y de export, nombres públicos definitivos de tokens/APIs |
| Agregar un segundo renderer | Evaluación de gobernanza (regla 7), `VisualizationRendererPort` con contract tests, negociación de capacidades |
| Custom Visual SDK | Todo lo anterior, más la extensión de la gramática de `VisualSpec` |
