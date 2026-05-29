const { app, net } = require('electron');

app.whenReady().then(async () => {
  const query = "Campfire Cooking in Another World with my Absurd Skill Season 2";
  
  // Test AnimePahe search
  const paheResp = await net.fetch(`https://animepahe.pw/api?m=search&q=${encodeURIComponent(query)}`);
  const paheData = await paheResp.json();
  console.log("AnimePahe:", paheData.data?.map(r => r.title));

  // Test Anikoto search
  const anikotoResp = await net.fetch(`https://anikototv.to/filter?keyword=${encodeURIComponent(query)}`);
  const anikotoHtml = await anikotoResp.text();
  const results = [];
  const itemRe = /<div class="item[^>]*>[\s\S]*?href="[^"]*\/watch\/([^/"]+)[^"]*"[\s\S]*?<img src="([^"]+)" alt="([^"]+)"/g;
  let match;
  while ((match = itemRe.exec(anikotoHtml)) !== null) {
    results.push(match[3]);
  }
  console.log("Anikoto:", results);

  app.quit();
});
