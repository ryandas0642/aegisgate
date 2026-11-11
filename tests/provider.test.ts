import test from 'node:test';
import assert from 'node:assert/strict';
import { Provider } from '../control/provider.js';
import { finding } from './fixtures.js';
const key = 'unit-fixture-key-never-a-real-secret',
  config = { key, model: 'test/fixture' };
const reply = () => ({
  id: 'fixture-request',
  model: 'test/returned',
  usage: { prompt_tokens: 3 },
  choices: [
    {
      finish_reason: 'stop',
      message: {
        content: JSON.stringify({
          plan: ['Inspect actual evidence.'],
          requests: [],
          finding,
          proposal: null,
        }),
        reasoning: 'PRIVATE_REASONING_NOT_TO_PERSIST',
      },
    },
  ],
});
test('provider transmits strict output schema and records only public response fields', async () => {
  const records: unknown[] = [];
  const provider = new Provider(config, (async (url: any, init: any) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Authorization, 'Bearer ' + key);
    const body = JSON.parse(init.body);
    assert.equal(body.response_format.json_schema.strict, true);
    const schema = JSON.stringify(body.response_format.json_schema.schema);
    assert.ok(!schema.includes('uniqueItems') && !schema.includes('minLength') && !schema.includes('maxLength'));
    return new Response(JSON.stringify(reply()), { status: 200 });
  }) as typeof fetch);
  const result = await provider.decide({}, new Set(['event-1']), async (type, value) => {
    records.push({ type, value });
  });
  assert.equal(result.requestId, 'fixture-request');
  assert.ok(!JSON.stringify(records).includes(key));
  assert.ok(!JSON.stringify(records).includes('PRIVATE_REASONING'));
});
test('provider failures, malformed output, truncation, and missing provenance fail closed', async () => {
  for (const mode of ['missing-key', 'http', 'malformed', 'truncated', 'identity', 'timeout']) {
    let calls = 0;
    const provider = new Provider(
      mode === 'missing-key' ? { ...config, key: '' } : config,
      (async () => {
        calls++;
        if (mode === 'timeout') throw new DOMException('Timed out', 'TimeoutError');
        const body = reply();
        if (mode === 'malformed') body.choices[0].message.content = '{}';
        if (mode === 'truncated') body.choices[0].finish_reason = 'length';
        if (mode === 'identity') body.id = '';
        return new Response(
          JSON.stringify(mode === 'http' ? { error: { message: 'unauthorized' } } : body),
          { status: mode === 'http' ? 401 : 200 },
        );
      }) as typeof fetch,
    );
    await assert.rejects(
      provider.decide({}, new Set(['event-1']), async () => {}),
      mode === 'identity' ? undefined : undefined,
    );
    assert.ok(calls <= 1);
  }
});
