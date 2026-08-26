const { app, net } = require("electron");

app.whenReady().then(async () => {
  const subUrl = "https://1oe.lostproject.club/anime/0412057393e8a45b3ba8b16874b6034d/265389ed4fb2f83a4306ebb2f4056923/subtitles/a6488c27d28cd2cd9ad160430a5df496_133355_sub_eng-0.vtt";
  
  // Test with megaplay Referer
  try {
    const resp = await net.fetch(subUrl, {
      headers: {
        "Referer": "https://megaplay.buzz/",
        "Origin": "https://megaplay.buzz"
      }
    });
    console.log("Megaplay Referer fetch status:", resp.status);
    if (resp.ok) {
      const text = await resp.text();
      console.log("Megaplay fetch preview:", text.slice(0, 100));
    }
  } catch (e) {
    console.error("Megaplay Referer fetch failed", e);
  }

  // Test with mewcdn Referer
  try {
    const resp = await net.fetch(subUrl, {
      headers: {
        "Referer": "https://mewcdn.online/",
        "Origin": "https://mewcdn.online"
      }
    });
    console.log("Mewcdn Referer fetch status:", resp.status);
    if (resp.ok) {
      const text = await resp.text();
      console.log("Mewcdn fetch preview:", text.slice(0, 100));
    }
  } catch (e) {
    console.error("Mewcdn Referer fetch failed", e);
  }

  app.quit();
});
