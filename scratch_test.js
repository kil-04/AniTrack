fetch('https://graphql.anilist.co', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: `query {
      Page(page: 1, perPage: 10) {
        media(tag_in: ["Isekai"]) {
          title { english romaji }
          tags { name rank }
        }
      }
    }`
  })
}).then(r => r.json()).then(d => {
  console.log(JSON.stringify(d, null, 2));
}).catch(console.error);
