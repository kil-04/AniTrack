const fs = require('fs');

async function checkShow(animeId) {
  console.log(`\n================ Checking show: ${animeId} ================`);
  try {
    const watchResp = await fetch(`https://anikototv.to/watch/${animeId}/ep-1`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const html = await watchResp.text();
    const idMatch = html.match(/id="watch-main"[^>]*data-id="([^"]+)"/) || html.match(/data-id="([^"]+)"/);
    if (!idMatch) {
      console.log(`Failed to get showId for ${animeId}`);
      return;
    }
    const showId = idMatch[1];
    
    const listResp = await fetch(`https://anikototv.to/ajax/episode/list/${showId}`, {
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'User-Agent': 'Mozilla/5.0' }
    });
    const listJson = await listResp.json();
    const listHtml = listJson.result;
    
    // Find first episode's data-ids
    const match = /<a[^>]+data-ids="([^"]+)"[^>]*>/.exec(listHtml);
    if (!match) {
      console.log(`No episodes found for ${animeId}`);
      return;
    }
    const serversParam = match[1];
    
    // Fetch servers list AJAX
    const serversResp = await fetch(`https://anikototv.to/ajax/server/list?servers=${encodeURIComponent(serversParam)}`, {
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'User-Agent': 'Mozilla/5.0' }
    });
    const serversJson = await serversResp.json();
    const serversHtml = serversJson.result;
    
    console.log(`Servers HTML contains H-SUB?`, serversHtml.toUpperCase().includes('H-SUB'));
    if (serversHtml.toUpperCase().includes('H-SUB')) {
      console.log('Found H-SUB HTML snippet:');
      console.log(serversHtml);
      return true;
    }
  } catch (err) {
    console.error(err);
  }
  return false;
}

async function run() {
  const shows = [
    'solo-leveling-ilh08',
    'dandadan-lzcmw',
    'sakamoto-days-sfdxz',
    'city-hunter-2-zxpcu',
    'naruto-shippuden-c8gov'
  ];
  for (const show of shows) {
    const found = await checkShow(show);
    if (found) break;
  }
}

run();
