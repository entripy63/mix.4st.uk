async function fetchDJMixes(djPath) {
  const response = await fetch(`${djPath}/index.html`);
  const html = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  
  const mixes = [];
  const rows = doc.querySelectorAll('table.border tr');
  
  rows.forEach(row => {
    const link = row.querySelector('td a');
    if (link) {
      mixes.push({
        name: link.textContent,
        htmlPath: `${djPath}/${link.getAttribute('href')}`
      });
    }
  });
  
  return mixes;
}
