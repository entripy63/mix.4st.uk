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

function detectGroups(mixes) {
  const prefixCounts = {};
  
  mixes.forEach(mix => {
    const words = mix.name.split(' ');
    let prefix = words[0];
    if (words.length > 1 && words[0] === 'Around' && words[1] === 'The') {
      prefix = 'Around The Houses';
    }
    prefixCounts[prefix] = (prefixCounts[prefix] || 0) + 1;
  });
  
  const groups = Object.keys(prefixCounts).filter(p => prefixCounts[p] >= 2);
  return groups.sort();
}

function filterMixes(mixes, group, allGroups) {
  if (!group) return mixes;
  if (group === 'Other') {
    return mixes.filter(mix => {
      return !allGroups.some(g => {
        if (g === 'Around The Houses') {
          return mix.name.startsWith('Around The Houses');
        }
        return mix.name.startsWith(g + ' ');
      });
    });
  }
  return mixes.filter(mix => {
    if (group === 'Around The Houses') {
      return mix.name.startsWith('Around The Houses');
    }
    return mix.name.startsWith(group + ' ');
  });
}

async function fetchMixDetails(htmlPath) {
  const response = await fetch(htmlPath);
  const html = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  
  const audio = doc.querySelector('audio');
  const audioSrc = audio ? audio.getAttribute('src') : null;
  
  const h1 = doc.querySelector('h1[id], h1:not(:first-of-type)') || 
             Array.from(doc.querySelectorAll('h1')).find(h => h.textContent.includes('Track List'));
  const trackListHeading = h1 ? h1.outerHTML : '';
  
  const table = doc.querySelector('table.border');
  const trackListTable = table ? table.outerHTML : '';
  
  const dir = htmlPath.substring(0, htmlPath.lastIndexOf('/') + 1);
  const fullAudioSrc = audioSrc ? dir + audioSrc : null;
  
  return { audioSrc: fullAudioSrc, trackListHeading, trackListTable };
}
