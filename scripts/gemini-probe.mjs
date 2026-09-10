/**
 * Asks the Gemini API which models this key can actually use, then tries a
 * real structured-output call against the best candidates.
 *
 * Run:  node scripts/gemini-probe.mjs AIza...your-key
 */
const KEY = process.argv[2];
if (!KEY) {
  console.error('Usage: node scripts/gemini-probe.mjs <your-gemini-api-key>');
  process.exit(1);
}

const VERSIONS = ['v1beta', 'v1'];

for (const version of VERSIONS) {
  const url = `https://generativelanguage.googleapis.com/${version}/models`;
  const res = await fetch(url, { headers: { 'x-goog-api-key': KEY } });
  console.log(`\n=== ${version}/models -> HTTP ${res.status} ===`);
  if (!res.ok) {
    console.log((await res.text()).slice(0, 300));
    continue;
  }
  const data = await res.json();
  const usable = (data.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''));
  console.log(usable.length ? usable.join('\n') : '(none support generateContent)');
}

// Now try an actual structured call against the likely candidates, newest first.
const CANDIDATES = [
  'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest',
  'gemini-2.5-flash-lite', 'gemini-1.5-flash', 'gemini-pro-latest'
];

const SCHEMA = {
  type: 'object',
  properties: {
    unopened_fridge: { type: 'integer', nullable: true },
    opened_fridge: { type: 'integer', nullable: true },
    freezer: { type: 'integer', nullable: true },
    pantry: { type: 'integer', nullable: true }
  },
  required: ['unopened_fridge', 'opened_fridge', 'freezer', 'pantry']
};

console.log('\n=== live generateContent test (whole milk) ===');
for (const version of VERSIONS) {
  for (const model of CANDIDATES) {
    const url = `https://generativelanguage.googleapis.com/${version}/models/${model}:generateContent`;
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Shelf life in days for whole milk, home storage.' }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: SCHEMA,
            temperature: 0,
            maxOutputTokens: 300
          }
        })
      });
    } catch (e) {
      console.log(`  ${version}/${model.padEnd(24)} network error: ${e.message}`);
      continue;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const reason = (body.match(/"message":\s*"([^"]{0,90})/) || [])[1] || '';
      console.log(`  ${version}/${model.padEnd(24)} HTTP ${res.status}  ${reason}`);
      continue;
    }

    const data = await res.json();
    const finish = data?.candidates?.[0]?.finishReason;
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    console.log(`  ${version}/${model.padEnd(24)} OK  finish=${finish}  ${String(text).replace(/\s+/g, ' ').slice(0, 90)}`);
  }
}

console.log('\nUse the first line above marked OK — paste it back and I will pin that model.');
