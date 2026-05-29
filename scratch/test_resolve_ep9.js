const { app, net } = require("electron");

app.whenReady().then(async () => {
  const BASE_URL = "https://anikoto.cz";
  const serversParam = "enB3TnhPcWV6SzB0L2VMWGdRVUROUGFDMFhDS29naGZ1SWFCeThNUFBRa2tQOGhTaTBwVVZCNVhaN3FkQ2VsZkt4N2NpNHk1RUJVRHp3WVNUbWFtNUdBY1VKS3BLeTlqM3pNZWZZMFU4OE5zamJoOEhQRVZKbHZtNzhVaXJXL0FtMVpYOTFKem1qellpYk1ZbHp1ejVRPT0";

  try {
    console.log("1. Fetching server list...");
    const serversResp = await net.fetch(`${BASE_URL}/ajax/server/list?servers=${encodeURIComponent(serversParam)}`, {
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    });
    const serversJson = await serversResp.json();
    const serversHtml = serversJson.result || "";
    console.log("Servers HTML snippet:", serversHtml.substring(0, 500));

    // Parse types
    const types = [];
    const typeRe = /<div class="type"[^>]*>([\s\S]*?)<\/ul>\s*<\/div>/g;
    let typeMatch;
    while ((typeMatch = typeRe.exec(serversHtml)) !== null) {
      const typeHtml = typeMatch[1];
      const labelM = /<label[^>]*>([\s\S]*?)<\/label>/.exec(typeHtml);
      const label = labelM ? labelM[1].replace(/<[^>]+>/g, '').trim() : '';
      
      const liRe = /<li[^>]+data-link-id="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g;
      let liMatch;
      const items = [];
      while ((liMatch = liRe.exec(typeHtml)) !== null) {
        items.push({
          linkId: liMatch[1],
          name: liMatch[2].replace(/<[^>]+>/g, '').trim()
        });
      }
      types.push({ label, items });
    }

    console.log("Parsed types:", JSON.stringify(types, null, 2));

    const isHardLabel = (labelStr) => {
      const l = labelStr.toUpperCase();
      return l.includes("H-SUB") || l.includes("H SUB") || l.includes("HARDSUB") || l.includes("HARD SUB") || l.includes("HSUB");
    };

    const isSoftLabel = (labelStr) => {
      const l = labelStr.toUpperCase();
      return l.includes("SUB") && !isHardLabel(labelStr);
    };

    const targetType = types.find(t => isSoftLabel(t.label));
    let ajaxLinkId = "";
    if (targetType && targetType.items.length > 0) {
      ajaxLinkId = targetType.items[0].linkId;
    } else if (types.length > 0 && types[0].items.length > 0) {
      ajaxLinkId = types[0].items[0].linkId;
    }

    console.log("Selected ajaxLinkId:", ajaxLinkId);

    if (!ajaxLinkId) {
      console.log("No links found!");
      app.quit();
      return;
    }

    console.log("2. Fetching server URL...");
    const serverGetResp = await net.fetch(`${BASE_URL}/ajax/server?get=${encodeURIComponent(ajaxLinkId)}`, {
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    });
    const serverGetJson = await serverGetResp.json();
    const iframeUrl = serverGetJson.result?.url || "";
    console.log("Iframe URL:", iframeUrl);

    if (!iframeUrl) {
      console.log("No iframe URL!");
      app.quit();
      return;
    }

    console.log("3. Fetching Megaplay page...");
    const megaplayResp = await net.fetch(iframeUrl, {
      headers: { 'Referer': `${BASE_URL}/` }
    });
    const megaplayHtml = await megaplayResp.text();
    const match = megaplayHtml.match(/id="megaplay-player"[^>]*data-id="([^"]+)"/) || megaplayHtml.match(/data-id="([^"]+)"/);
    if (!match) {
      console.log("Failed to match megaplay-player data-id!");
      console.log("HTML length:", megaplayHtml.length);
      console.log("HTML preview:", megaplayHtml.substring(0, 1000));
      app.quit();
      return;
    }

    const megaplayId = match[1];
    console.log("Extracted megaplayId:", megaplayId);

    console.log("4. Fetching getSources...");
    const resp = await net.fetch(`https://megaplay.buzz/stream/getSources?id=${megaplayId}`, {
      headers: {
        'Referer': iframeUrl,
        'X-Requested-With': 'XMLHttpRequest'
      }
    });
    const json = await resp.json();
    console.log("getSources response:", JSON.stringify(json, null, 2));

  } catch (err) {
    console.error("Error:", err);
  }

  app.quit();
});
