type SearchResult = { path: string; title: string; description: string };

export function startCommandPalette(): void {
  const openButton = document.querySelector<HTMLButtonElement>('#command-open');
  const closeButton = document.querySelector<HTMLButtonElement>('#command-close');
  const dialog = document.querySelector<HTMLDialogElement>('#command-palette');
  const input = document.querySelector<HTMLInputElement>('#command-query');
  const results = document.querySelector<HTMLUListElement>('#command-results');
  if (!openButton || !closeButton || !dialog || !input || !results) return;

  openButton.hidden = false;
  const open = () => {
    dialog.showModal();
    input.focus();
  };
  openButton.addEventListener('click', open);
  closeButton.addEventListener('click', () => dialog.close());
  document.addEventListener('keydown', event => {
    const target = event.target as HTMLElement;
    if ((event.ctrlKey && event.key.toLowerCase() === 'k') ||
      (event.key === '/' && !target.matches('input, textarea, [contenteditable]'))) {
      event.preventDefault();
      open();
    }
  });

  let requestNumber = 0;
  input.addEventListener('input', async () => {
    const currentRequest = ++requestNumber;
    results.replaceChildren();
    const query = input.value.trim();
    if (!query) return;
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      if (!response.ok) return;
      const matches = await response.json() as SearchResult[];
      if (currentRequest !== requestNumber) return;
      for (const match of matches) {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.href = match.path;
        link.textContent = match.title;
        item.append(link);
        results.append(item);
      }
    } catch {
      results.replaceChildren();
    }
  });
}
