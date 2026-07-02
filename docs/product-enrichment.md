# Product enrichment (CSV round-trip)

A repeatable way to add rich detail to every product — línea, color, medidas,
material, capacidad, presentación (docena / media docena), usos, compatibilidad
y descripciones — using a spreadsheet plus AI for first drafts. All content in
Spanish.

Details live in `products.attributes` (JSONB). Prices, categoría del menú,
activo/inactivo and stock stay in the admin UI — the CSV never changes them.

## Who each field serves

| Audience | What they need | Fields that serve it |
|---|---|---|
| **AI (Ventas IA)** | Accurate facts to match customer requests & photos | all attributes — they are injected into the sales-AI prompt (compact form) |
| **Customer** | Quote lines that identify the product | `name` (already carries color + presentación), `long_description` on the menu |
| **Sales** | Recognize the product instantly when quoting | naming convention `Tipo + tamaño + color + (presentación)` + SKU |
| **Admin** | Material & process costing | `material`, `weight`, `unidades_por_lote` (costs per lot = per-piece × lote); process costing lives in "Configurar producción" per SKU |

## Easiest: in the admin panel (no terminal)

Admins get **Descargar CSV** and **Elegir CSV para importar** buttons on the
Product Catalog admin page:

1. **Descargar CSV** → the full catalog downloads with all columns.
2. Fill it in (Excel / Google Sheets), with colleagues if you like.
3. **Elegir CSV para importar** → a **preview** shows updates / skipped /
   unknown SKUs / duplicates / warnings — nothing is written yet.
4. Tick "Actualizar nombres" / "Copiar descripción larga al menú" if wanted,
   then **Aplicar cambios**.

The CLI scripts (`scripts/export-products-csv.js`, `scripts/import-products-csv.js`)
do the same thing for local/server use. Migrations run automatically on deploy.

## Column dictionary

| Column | Editable? | Meaning |
|---|---|---|
| `sku` | match key | Identifies the product. Never changed by import. |
| `name` | opt-in | Context; edits apply only with `--update-names` / "Actualizar nombres". Convention: `Tipo + tamaño + color + (presentación)` — this is what sales and customers see on quotes. |
| `category` | context | `Tablero` / `Accesorio` (orientation only; the app's menu category is managed in the admin UI). |
| `is_active`, `sf_price`, `cf_price` | context | Never imported. **Prices are per presentación** (a dozen = one sellable unit). |
| `product_line` | yes | `Acero` (trabajo pesado) or `Armonia` (trabajo liviano). Normalized on import. |
| `color` | yes | Negro, Blanco, Rojo, Cromo… |
| `size` | yes | Physical size token: `5cm`, `Grande`, `47x64`, `J`. (Not the lot quantity — see `unidades_por_lote`.) |
| `dimensions` | yes | Real measurements, e.g. `47 x 64 cm`. |
| `material` | yes | `Acero al carbono`, `Plástico`, `Acero cromado`… |
| `weight` | yes | e.g. `1.2 kg`. |
| `load_capacity` | yes | Max load in weight, e.g. `5 kg`. |
| `capacidad` | yes | How many items a holder holds, e.g. `10 desarmadores`, `8 llaves`. |
| `unidades_por_lote` | yes | Pieces per sellable unit: `12` (docena), `6` (media docena), `1`. |
| `presentacion` | yes | Label people see: `Docena`, `Media docena`, `Unidad`. |
| `works_with` | yes | What it holds / is used for. Separate with `;` (or one per line). |
| `compatible` | yes | SKUs it works with, either direction (accessory → boards, board → accessories). `;`- or newline-separated. Import warns if A lists B but B doesn't list A back, and if a referenced SKU doesn't exist. |
| `variant_group` | yes | Groups color/size variants, e.g. `Tablero 61x95`, `Gancho 5cm Armonia`. |
| `long_description` | yes | One-two sentence product description (customer-facing with `--sync-description`). |
| `ambientes` | yes | Environments / use contexts (line-level text is fine). |
| `status`, `notes` | yes | Workflow markers (`REVISAR`, `VERIFIED`) and free notes. |

Legacy headers are accepted on import: `menu_category`→`category`,
`compatible_boards`/`compatible_con`→`compatible`, `lote`→`unidades_por_lote`,
`notas`→`notes`.

## Import safety

Dry-run preview by default; SKU-matched; unknown SKUs skipped (never created);
blank cells preserve existing values (merge); duplicate SKUs in the file — only
the first row applies, with a warning; rows without SKU are reported and
skipped; `compatible` references and symmetry are validated with warnings.

Example queries once loaded:

```sql
-- accessories that fit board T6195N
SELECT sku, name FROM products WHERE attributes->'compatible' ? 'T6195N';
-- everything in the Armonia line
SELECT sku, name FROM products WHERE attributes->>'product_line' = 'Armonia';
```

## How the AI uses this

`lib/salesAssistant.js` injects a compact attribute summary per product into the
Ventas IA prompt (línea, presentación/lote, capacidad, compatible, first uses),
and instructs the model that prices are per presentación and to respect
compatibility when recommending. Keep `works_with` honest and `compatible`
complete — that is what the model reasons over.
