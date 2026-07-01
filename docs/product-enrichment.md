# Product enrichment (CSV round-trip)

A repeatable way to add rich detail to every product — colour, size, dimensions,
material, physical specs, the tools/items each accessory holds, accessory→board
compatibility, and a customer-facing description — using a spreadsheet plus AI to
do the first draft.

Details live in `products.attributes` (a JSONB column added by
`migrations/20260701_add_product_attributes.sql`). Nothing here changes prices,
names, categories, or stock — those stay in the admin UI.

## Easiest: in the admin panel (no terminal)

Admins get **Descargar CSV** and **Elegir CSV para importar** buttons on the
Product Catalog admin page (once this branch is deployed — the migration runs
automatically on startup):

1. Click **Descargar CSV** → the full catalog downloads as `products-enrichment.csv`.
2. Fill it in (Excel / Google Sheets), optionally with help from colleagues.
3. Click **Elegir CSV para importar** → a **preview** shows what will change
   (updates / skipped / unknown SKUs) without writing anything.
4. Tick "Actualizar nombres" / "Copiar descripción larga al menú" if wanted,
   then click **Aplicar cambios**.

The command-line scripts below do the same thing for local/server use.

## The loop (command line)

```
1. Apply the migration            node scripts/migrate.js   (auto-runs on deploy)
2. Export the live catalog         node scripts/export-products-csv.js
3. Draft with AI                   (see "AI draft" below) — fills the derivable columns
4. Verify & fill by hand           open the CSV, correct AI guesses, add real specs
5. Import (dry run first)          node scripts/import-products-csv.js products-enrichment.csv
6. Import for real                 node scripts/import-products-csv.js products-enrichment.csv --commit
```

Step 5 prints exactly what would change and writes nothing. Only `--commit`
writes. Rows are matched by **SKU**; unknown SKUs are reported and skipped, never
created. Blank cells are left unchanged (merge, not overwrite), so you can enrich
in passes.

Add `--sync-description` on import to also copy `long_description` into the
`description` column (what the public menu shows). Otherwise it stays only in
`attributes.long_description`.

Add `--update-names` to also rename products from the `name` column (the SKU
stays the key). Without it, `name` edits are ignored. Prices, category, and
active status are always managed in the admin UI, not this CSV.

## Column dictionary

| Column | Editable? | Meaning |
|---|---|---|
| `sku` | match key | Identifies the product. Don't change it. |
| `name` | context / opt-in | Shown for orientation. Edits are ignored unless you pass `--update-names` on import (the SKU always stays the key). |
| `menu_category`, `is_active`, `sf_price`, `cf_price` | context only | Shown for orientation; **import ignores edits** to these — manage in the admin UI. |
| `product_line` | yes | Which line the product belongs to: `Acero` or `Armonia`. Import normalizes casing/accents; other values pass through with a warning. |
| `color` | yes | Colour (e.g. Negro, Rojo, Cromo). |
| `size` | yes | Size token (e.g. `61x95`, `Grande`, `5cm`). |
| `dimensions` | yes | Physical size (e.g. `61 x 95 cm`). |
| `material` | yes | e.g. `Acero`, `PVC`. AI can't know this — you fill it. |
| `weight` | yes | e.g. `1.2 kg`. You fill it. |
| `load_capacity` | yes | Max load an accessory holds, e.g. `5 kg`. You fill it. |
| `works_with` | yes | Tools/items an accessory holds. `;`-separated, e.g. `Desarmadores; Llaves`. |
| `compatible_boards` | yes | Board SKUs an accessory fits. `;`-separated, e.g. `T6195N; T9495N`. Varies by board — you confirm. |
| `variant_group` | yes | Groups variants: boards by size (`T6195`), accessories by family (`Repisa`). |
| `long_description` | yes | Customer-facing description. |
| `status` | yes | `AI-draft` or `VERIFIED` — your workflow marker. |
| `notes` | yes | Anything (e.g. "confirm compatibility"). |

`works_with` and `compatible_boards` are stored as JSON arrays; everything else as
strings. To query later, e.g. "accessories that fit board T6195N":
`SELECT sku, name FROM products WHERE attributes->'compatible_boards' ? 'T6195N';`

## AI draft

The catalog is small and regular, so AI can reliably fill the **derivable**
columns from the SKU + name: `color`, `size`, `variant_group`, a `works_with`
guess for accessories, and a `long_description` draft. It **cannot** know real
specs — `material`, `weight`, `load_capacity`, exact `dimensions`, and true
`compatible_boards` must be verified by you.

Prompt to run against the AI provider (or paste the exported CSV to Claude):

> You are enriching a Spanish-language pegboard product catalog (Tableros =
> perforated boards; Accesorios = holders that clip onto them). For each row,
> fill ONLY these columns from the SKU and name: color, size, variant_group,
> works_with (tools an accessory holds, `;`-separated), long_description (one
> clean Spanish sentence). Leave material, weight, load_capacity, dimensions,
> and compatible_boards blank — I will verify those. Set status=AI-draft. Return
> the same CSV columns. Do not invent specs you can't derive from the name.

Then verify every row, fill the spec/compatibility columns, set `status=VERIFIED`,
and import.
