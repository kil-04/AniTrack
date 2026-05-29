const radixStr = '62';
const keysStr = '|||player|||on|sendMessage|event||play|if|data|element||hls|video|pause|window|const|true|var|function|message|eventHandler|eventName|source|ended|currentTime|querySelector|document|ready|stop|bindEvent|attachEvent|else|addEventListener|config|Hls|new|1000|fullscreen|volume|01|toFixed|String|innerHTML|timestamp|ss|timeupdate|postMessage|parent|false|landscape|lock|orientation|screen|enterfullscreen|attachMedia|loadSource|lowLatencyMode|enableWorker|nudgeMaxRetry|600|maxMaxBufferLength|300|maxBufferLength|||120|maxBufferSize|90|backBufferLength|src|isSupported|iosNative|capture|airplay|pip|settings|captions|mute|time|current|progress|forward|fast|rewind|large|controls|kwik|key|storage|25|75|options|selected|speed|seekTime|ratio|global|keyboard|Plyr|m3u8|uwu|fd5df03e8965847570e4722cba487524b4a2512037fe2ba6acc4ad0a69ccf7c4|stream|top|uwucdn|vault|https';
const radix = parseInt(radixStr, 10);
const keys = keysStr.split('|');

function baseN(n) {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (n === 0) return '0';
  let r = '';
  while (n > 0) { r = chars[n % radix] + r; n = Math.floor(n / radix); }
  return r;
}

const lookup = {};
keys.forEach((w, i) => { if (w) lookup[baseN(i)] = w; });

console.log("lookup['1M'] =", lookup['1M']);
console.log("Keys at 110 =", keys[110]);
console.log("baseN(110) =", baseN(110));

const encoded = "j q='1M://1L-H.1K.1J/1I/H/16/1H/1G.1F'";
const fixedUnpacked = encoded.replace(/\b\w+\b/g, (w) => lookup[w] || w);
console.log("fixedUnpacked:", fixedUnpacked);
