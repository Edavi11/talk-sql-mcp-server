# 🗂️ talk-sql — Handoff de nuevas funcionalidades

> Documento de traspaso con ideas de funcionalidades para implementar progresivamente.
> Estado del proyecto al crear este doc: **v1.1.2** (9 tools, soporte PostgreSQL · MySQL · SQL Server · SQLite · IBM DB2).

## 📌 Cómo usar este documento
Cada funcionalidad tiene: descripción, motivación, impacto/esfuerzo estimado y archivos probablemente afectados.
A medida que se implementen, marcar la casilla y mover notas relevantes al PR/commit correspondiente.

**Recomendación de orden de arranque:**
1. `db_describe_table` — máximo impacto en la calidad del SQL que genera la IA.
2. Modo solo-lectura / freno destructivo — lo que más le falta a nivel de seguridad.

---

## 🔍 Exploración e introspección de esquemas
La IA hoy puede listar tablas, pero "vuela a ciegas" sobre la estructura interna. Esto es lo que más rinde para que escriba mejor SQL.

- [ ] **`db_describe_table`** ⭐ *(prioridad alta)*
  Columnas con tipos, nullability, defaults, PKs, FKs, índices y constraints de una tabla.
  **Motivación:** hoy la IA tiene que consultar `information_schema` a mano, con sintaxis distinta por motor. Encapsularlo es el mejor ROI.
  **Impacto:** Alto · **Esfuerzo:** Medio
  **Archivos:** `src/tools/database-tools.ts` (o nuevo `schema-tools.ts`), `src/services/query-executor.ts`, `src/index.ts` (registro).

- [ ] **`db_get_relations`**
  El grafo de FKs de un esquema, para que la IA entienda cómo unir tablas sin adivinar.
  **Impacto:** Medio-Alto · **Esfuerzo:** Medio

- [ ] **`db_sample_table`**
  Primeras N filas + estadísticas básicas (count, distinct, % nulos por columna). Da contexto real de los datos, no solo del esquema.
  **Impacto:** Medio · **Esfuerzo:** Bajo-Medio

- [ ] **`db_search`**
  Buscar una tabla/columna por nombre o patrón en toda la DB ("¿dónde está el email del usuario?").
  **Impacto:** Medio · **Esfuerzo:** Bajo

---

## 📊 Diagrama Entidad-Relación (ERD) exportable a archivo ⭐ *(prioridad alta)* ✅ IMPLEMENTADO

> **Estado:** Implementado. Tool `db_export_er_diagram` registrada, con introspección multi-motor,
> serializadores Mermaid/DBML/JSON/DOT, escritura a disco y tests (11 tests propios; suite total 373 verde).
> Archivos: `src/services/schema-introspection.ts`, `src/services/diagram-serializers.ts`,
> `src/tools/diagram-tools.ts`, registro en `src/index.ts`, README actualizado.

- [x] **`db_export_er_diagram`**
  Introspecciona el **esquema completo** de la DB (tablas, columnas, tipos, PKs, FKs) y genera un archivo de diagrama ER que se puede **visualizar con extensiones de VS Code / Cursor**.

  **Motivación:** materializa el esquema como un diagrama navegable en el editor, sin que la IA tenga que reconstruirlo mentalmente. Reutiliza la introspección de `db_describe_table` + `db_get_relations`.

  **Impacto:** Alto · **Esfuerzo:** Bajo-Medio (la introspección es lo costoso; los serializadores son simples plantillas de texto)

  ### Decisiones de diseño (acordadas)
  - **Multi-formato**: la tool soporta varios formatos de salida; se le **pregunta al usuario** (o se pasa por parámetro) cuál prefiere.
  - **Escribe a disco directamente** vía `output_path`. Default: **raíz del proyecto de trabajo**; o la ruta que el usuario indique.
  - **Alcance: esquema completo** — todas las tablas y relaciones (sin filtros por ahora).

  ### Formatos a soportar
  | Formato | Extensión | Visor en VS Code/Cursor |
  |---|---|---|
  | **Mermaid** (`erDiagram`) | `.md` / `.mmd` | Markdown Preview / Mermaid (nativo, cero fricción) — *default sugerido* |
  | **DBML** | `.dbml` | Extensión DBML + dbdiagram.io |
  | **JSON** (nodos/aristas) | `.json` | Consumible por otras tools/extensiones |
  | **Graphviz DOT** | `.dot` / `.gv` | Graphviz Preview |

  ### Parámetros propuestos
  ```
  - connection_name / connection_string (igual que el resto de tools)
  - database (opcional)
  - schema (opcional — si no se da, esquema completo de la DB)
  - format ('mermaid' | 'dbml' | 'json' | 'dot')   # preguntar al usuario si no se especifica
  - output_path (string)  # default: <raíz del proyecto>/schema.<ext>
  - response_format ('markdown' | 'json')  # confirmación de la operación
  ```

  ### Retorno (confirmación, no el diagrama completo)
  ```json
  {
    "success": true,
    "format": "mermaid",
    "output_path": "C:/.../schema.md",
    "tables": 12,
    "relations": 18
  }
  ```

  ### Notas de implementación
  - Núcleo de introspección compartido: una función que devuelva `{ tables: [{name, columns:[{name,type,pk,nullable}], }], relations: [{from_table, from_col, to_table, to_col}] }` por motor (PostgreSQL/MySQL/SQL Server/SQLite/DB2), y luego **serializadores** por formato que consumen esa estructura intermedia.
  - Reutilizar la lógica de `db_describe_table` y `db_get_relations` cuando existan (o construirlas a partir de aquí).
  - Validar/normalizar `output_path` y crear directorios padre si faltan. Cuidado con escritura fuera del workspace.
  - `db_list_tables` ya hace parte del trabajo de listar tablas/esquemas — punto de partida.

  **Archivos:** nuevo `src/tools/diagram-tools.ts`, helper de introspección en `src/services/query-executor.ts` (o nuevo `schema-introspection.ts`), serializadores en `src/services/diagram-serializers.ts`, registro en `src/index.ts`, schema Zod en `src/schemas/`.

---

## 🛡️ Seguridad y control
Hoy `db_query` ejecuta **cualquier** SQL —incluido `DROP`/`DELETE`— marcado `destructiveHint: true` pero sin freno real. Para un MCP que una IA maneja sola, esto es el mayor riesgo abierto.

- [ ] **Modo solo-lectura** ⭐ *(prioridad alta)*
  `TALK_SQL_READONLY=true` (global) o por conexión en el config, que rechace DML/DDL.
  **Impacto:** Alto · **Esfuerzo:** Bajo-Medio
  **Archivos:** `src/constants.ts`, `src/schemas/connection.ts`, `src/tools/query-tools.ts`, `src/tools/ddl-tools.ts`, `src/tools/trigger-tools.ts`.

- [ ] **Confirmación / dry-run para operaciones destructivas**
  Detectar `DROP`/`TRUNCATE`/`DELETE`/`UPDATE` sin `WHERE` y devolver el plan en vez de ejecutar, salvo flag explícito.
  **Impacto:** Alto · **Esfuerzo:** Medio

- [ ] **Saneado / parametrización en `db_select`**
  Hoy `where` y `columns` se concatenan como strings → repasar inyección SQL.
  **Impacto:** Medio-Alto (seguridad) · **Esfuerzo:** Medio
  **Archivos:** `src/tools/query-tools.ts`.

- [ ] **Allow/deny-list de tablas o esquemas** por conexión.
  **Impacto:** Medio · **Esfuerzo:** Medio

---

## ⚡ Productividad de consultas

- [ ] **`db_explain`**
  Devolver el plan de ejecución (`EXPLAIN` / `EXPLAIN ANALYZE`) adaptado por motor. Útil para diagnosticar consultas lentas.
  **Impacto:** Medio · **Esfuerzo:** Medio

- [ ] **Exportar resultados a archivo (CSV/JSON)**
  Para datasets grandes que no caben en la respuesta del chat.
  **Impacto:** Medio · **Esfuerzo:** Medio

- [ ] **`db_count`**
  Atajo para contar filas con WHERE (hoy hay que usar `db_query`).
  **Impacto:** Bajo · **Esfuerzo:** Bajo

- [ ] **Histórico de queries de la sesión**
  Para que la IA pueda revisar lo que ya ejecutó.
  **Impacto:** Bajo-Medio · **Esfuerzo:** Medio

---

## 🏗️ DDL y migraciones
Extender lo que ya existe (`db_create_table`, `db_create_relation`, `db_create_trigger`).

- [ ] **`db_alter_table`** — añadir/quitar/modificar columnas.
  **Impacto:** Medio · **Esfuerzo:** Medio

- [ ] **`db_drop_*`** — drops explícitos (con el freno de seguridad de arriba). Hoy obligan a usar `db_query`.
  **Impacto:** Bajo-Medio · **Esfuerzo:** Bajo

- [ ] **`db_create_index`** — falta y es muy común.
  **Impacto:** Medio · **Esfuerzo:** Bajo

- [ ] **Generar diff/migración entre esquemas** o exportar el DDL de una tabla existente.
  **Impacto:** Medio · **Esfuerzo:** Alto

---

## 🔌 Infraestructura

- [ ] **Caché / reutilización de pools de conexión**
  El túnel SSH se abre y cierra por cada query (ver fix `4f0c86d`). Un pool reutilizable con TTL reduciría latencia notablemente en sesiones largas.
  **Impacto:** Medio-Alto (rendimiento) · **Esfuerzo:** Medio-Alto
  **Archivos:** `src/services/connection-manager.ts`, `src/services/ssh-tunnel.ts`, `src/constants.ts`.

- [ ] **Más motores de base de datos**
  Oracle · MariaDB (casi gratis con `mysql2`) · CockroachDB · MongoDB (si se quiere salir de SQL puro).
  **Impacto:** Variable · **Esfuerzo:** Variable

---

## ✅ Checklist transversal por funcionalidad
Para cada tool nueva, recordar:
- [ ] Registrar en `src/index.ts` con `annotations` correctas (`readOnlyHint`, `destructiveHint`, etc.).
- [ ] Schema de validación Zod (en `src/schemas/`).
- [ ] Soporte multi-motor en `query-executor` / `connection-manager`.
- [ ] Sección de *Error Handling / Next steps* en la descripción (consistente con el diseño "AI-first" actual).
- [ ] Soporte de `response_format` (`markdown` | `json`).
- [ ] Tests en `src/__tests__/` (Vitest).
- [ ] Actualizar `README.md` y bump de versión.
