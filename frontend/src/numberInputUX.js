// Comportamiento global de los campos numéricos: al enfocar un
// input[type=number] se selecciona todo su valor, así el usuario escribe el
// número nuevo directamente en lugar de borrar dígito por dígito. Aplica a
// toda la app (cantidades, precios, stock, descuentos) sin tocar cada input.
//
// El guardia de mouseup es necesario porque, con un clic, el navegador coloca
// el cursor DESPUÉS del focus y desharía la selección: se cancela ese único
// mouseup posterior al enfoque.

const isNumberInput = (el) =>
  el instanceof HTMLInputElement && el.type === 'number' && !el.readOnly && !el.disabled;

export function installNumberInputSelectAll(doc = document) {
  let selectOnMouseUp = null;

  doc.addEventListener('focusin', (event) => {
    const target = event.target;
    if (!isNumberInput(target)) return;
    selectOnMouseUp = target;
    try {
      target.select();
    } catch {
      /* algunos navegadores no permiten select() en type=number; sin drama */
    }
  });

  doc.addEventListener(
    'mouseup',
    (event) => {
      if (selectOnMouseUp && event.target === selectOnMouseUp) {
        event.preventDefault();
      }
      selectOnMouseUp = null;
    },
    true
  );
}
