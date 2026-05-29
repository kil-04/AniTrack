const { app, net } = require("electron");

app.whenReady().then(async () => {
  try {
    console.log("Fetching https://anikototv.to/filter?keyword=game ...");
    const resp1 = await net.fetch("https://anikototv.to/filter?keyword=game", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });
    console.log("Anikototv.to status:", resp1.status);
    console.log("Anikototv.to text:", (await resp1.text()).slice(0, 100));

    console.log("\nFetching https://anikoto.cz/filter?keyword=game ...");
    const resp2 = await net.fetch("https://anikoto.cz/filter?keyword=game", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });
    console.log("Anikoto.cz status:", resp2.status);
    console.log("Anikoto.cz text:", (await resp2.text()).slice(0, 100));

  } catch (err) {
    console.error("Fetch failed:", err);
  }
  app.quit();
});
