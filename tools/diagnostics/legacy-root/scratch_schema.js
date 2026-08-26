fetch('https://graphql.anilist.co', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: `query {
      __type(name: "Page") {
        fields {
          name
          args { name }
        }
      }
    }`
  })
}).then(r => r.json()).then(d => {
  const mediaField = d.data.__type.fields.find(f => f.name === 'media');
  console.log(mediaField.args.map(a => a.name).join(', '));
}).catch(console.error);
