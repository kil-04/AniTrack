const { app, net } = require("electron");

app.whenReady().then(async () => {
  try {
    console.log("Fetching https://anikototv.to/ ...");
    const resp = await net.fetch("https://anikototv.to/", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });
    console.log("Status:", resp.status);
    console.log("Headers:", JSON.stringify(resp.headers));
    const text = await resp.text();
    console.log("Body sample:", text.slice(0, 1000));
  } catch (err) {
    console.error("Fetch failed:", err);
  }
  app.quit();
});
