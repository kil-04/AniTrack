const { app, net } = require("electron");

app.whenReady().then(async () => {
  try {
    console.log("Fetching Anikoto search page for 'game'...");
    const resp = await net.fetch("https://anikototv.to/filter?keyword=game", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });
    const html = await resp.text();
    console.log("HTML length:", html.length);
    
    // Save to file to inspect
    const fs = require("fs");
    fs.writeFileSync("anikoto_search.html", html);
    console.log("Saved HTML to anikoto_search.html");
    
    // Let's print some segments containing href="/watch/
    let index = 0;
    while ((index = html.indexOf('/watch/', index)) !== -1) {
      console.log("Found /watch/ at index:", index);
      console.log(html.slice(index - 100, index + 300));
      console.log("-----------------------------------------");
      index += 7;
      if (index > 100000) break; // limit
    }
  } catch (err) {
    console.error("Fetch failed:", err);
  }
  app.quit();
});
