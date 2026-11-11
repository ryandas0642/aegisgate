import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
if (existsSync('.env')) {
  console.log(
    'Existing .env preserved. Set OPENROUTER_API_KEY there if you want live investigations.',
  );
} else {
  const values = {
    AEGIS_PROXY_TOKEN: randomBytes(32).toString('hex'),
    AEGIS_AGENT_TOKEN: randomBytes(32).toString('hex'),
    AEGIS_OPERATOR_PASSWORD: randomBytes(18).toString('base64url'),
    OPENROUTER_API_KEY: '',
    OPENROUTER_MODEL: 'openai/gpt-4.1-mini',
  };
  writeFileSync(
    '.env',
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n') + '\n',
    { flag: 'wx', mode: 0o600 },
  );
  console.log(
    'Created ignored .env with random local credentials. Read AEGIS_OPERATOR_PASSWORD locally to sign in. Add a provider key only if you want live model calls.',
  );
}
