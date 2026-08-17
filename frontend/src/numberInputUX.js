// Comportamiento global de los campos numéricos: al enfocar un
// input[type=number] se selecciona todo su valor, así el usuario escribe el
// número nuevo directamente en lugar de borrar dígito por dígito. Aplica a
// toda la app (cantidades, precios, stock, descuentos) sin tocar cada input.
//
// Con un clic, el navegador coloca el cursor DESPUÉS del focus y desharía la
// selección; en ese primer mouseup se vuelve a seleccionar todo. Importante:
// NUNCA se cancela el mouseup — hacerlo dejaba a las flechitas del spinner
// "pensando" que el botón seguía apretado y la cantidad se disparaba sola.

const isNumberInput = (el) =>
  el instanceof HTMLInputElement && el.type === 'number' && !el.readOnly && !el.disabled;

export function installNumberInputSelectAll(doc = document) {
  let reselectOnMouseUp = null;

  doc.addEventListener('focusin', (event) => {
    const target = event.target;
    if (!isNumberInput(target)) return;
    reselectOnMouseUp = target;
    try {
      target.select();
    } catch {
      /* algunos navegadores no permiten select() en type=number; sin drama */
    }
  });

  doc.addEventListener('mouseup', (event) => {
    const target = reselectOnMouseUp;
    reselectOnMouseUp = null;
    if (!target || event.target !== target || !isNumberInput(target)) return;
    // Después de que el navegador procese el clic (caret o spinner), se
    // restaura la selección completa. El spinner sigue funcionando normal.
    requestAnimationFrame(() => {
      if (doc.activeElement === target) {
        try {
          target.select();
        } catch {
          /* ídem */
        }
      }
    });
  });
}
