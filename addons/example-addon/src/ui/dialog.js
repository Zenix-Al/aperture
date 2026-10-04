export function renderExampleDialog() {
  return `
    <div class="aperture-example-dialog" data-example-root="dialog">
      <h3>Example Dialog</h3>
      <p>This dialog was opened through <code>ui.dialog.open</code>.</p>
      <p>You can close it from here, by pressing Escape, or by clicking the backdrop.</p>
      <div class="aperture-example-actions">
        <button type="button" class="aperture-example-button" data-example-action="toast-show">
          Toast from dialog
        </button>
        <button type="button" class="aperture-example-button" data-example-action="dialog-close">
          Close dialog
        </button>
      </div>
    </div>
  `;
}
