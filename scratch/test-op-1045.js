const fs = require('fs');

async function run() {
  const animeId = 'one-piece-odmau';
  console.log(`Checking show: ${animeId} Episode 1045`);
  try {
    const watchResp = await fetch(`https://anikototv.to/watch/${animeId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const html = await watchResp.text();
    const idMatch = html.match(/id="watch-main"[^>]*data-id="([^"]+)"/) || html.match(/data-id="([^"]+)"/);
    if (!idMatch) {
      console.log(`Failed to get showId`);
      return;
    }
    const showId = idMatch[1];
    
    const listResp = await fetch(`https://anikototv.to/ajax/episode/list/${showId}`, {
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'User-Agent': 'Mozilla/5.0' }
    });
    const listJson = await listResp.json();
    const listHtml = listJson.result;
    
    // Find Episode 1045's data-ids
    // Episode number is 1045
    const epMatchRe = /<a[^>]+data-num="1045"[^>]+data-ids="([^"]+)"[^>]*>/;
    const match = epMatchRe.exec(listHtml);
    if (!match) {
      console.log(`Episode 1045 not found in episodes list`);
      // print first few ep data-ids to inspect
      const sample = listHtml.match(/<a[^>]+data-num="[^"]+"[^>]+data-ids="[^"]+"[^>]*>/g) || [];
      console.log('Sample a tags:', sample.slice(-5));
      return;
    }
    const serversParam = match[1];
    console.log('Found serversParam for Ep 1045:', serversParam);
    
    // Fetch servers list AJAX
    const serversResp = await fetch(`https://anikototv.to/ajax/server/list?servers=${encodeURIComponent(serversParam)}`, {
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'User-Agent': 'Mozilla/5.0' }
    });
    const serversJson = await serversResp.json();
    const serversHtml = serversJson.result;
    
    fs.writeFileSync('scratch/op_1045_servers.html', serversHtml);
    console.log('Servers list HTML for One Piece Ep 1045:');
    console.log(serversHtml);
  } catch (err) {
    console.error(err);
  }
}

run();
