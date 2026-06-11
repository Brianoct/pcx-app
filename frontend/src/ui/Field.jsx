/**
 * Standard form field wrapper: label + control + optional hint.
 * Pair with the `.form-input` / `.form-select` / `.form-textarea` classes:
 *
 *   <Field label="Cliente" hint="0/26">
 *     <input className="form-input" ... />
 *   </Field>
 */
export function Field({ label, hint, className = '', children }) {
  return (
    <div className={`form-field ${className}`.trim()}>
      {label != null && label !== '' && <label className="form-label">{label}</label>}
      {children}
      {hint != null && hint !== '' && <div className="form-hint">{hint}</div>}
    </div>
  );
}

export default Field;
