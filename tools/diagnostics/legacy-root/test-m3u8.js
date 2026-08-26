const { app, net } = require("electron");

app.whenReady().then(async () => {
  const m3u8Url = "https://s1.streamzone1.site/anime/370de19ca33f45ee3e922464f1dc8248/860e990735c1aa9f62da573de74cddbf/master.m3u8";
  
  // Test with megaplay Referer
  try {
    const resp = await net.fetch(m3u8Url, {
      headers: {
        "Referer": "https://megaplay.buzz/",
        "Origin": "https://megaplay.buzz",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    });
    console.log("Megaplay Referer fetch status:", resp.status);
    if (resp.ok) {
      const text = await resp.text();
      console.log("Megaplay fetch preview:\n", text.slice(0, 150));
    }
  } catch (e) {
    console.error("Megaplay Referer fetch failed", e);
  }

  app.quit();
});
