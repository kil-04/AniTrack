type AccountEnvironment = Record<string, unknown>;

export function publicAccountConfig(environment: AccountEnvironment) {
  const al = environment.ANITRACK_ANILIST_CLIENT_ID;
  const mal = environment.ANITRACK_MAL_CLIENT_ID;
  return {
    alClientId: typeof al === 'string' && /^[0-9]{1,12}$/.test(al) ? al : '',
    malClientId: typeof mal === 'string' && /^[a-zA-Z0-9]{10,80}$/.test(mal) ? mal : '',
  };
}

export function malClientSecret(environment: AccountEnvironment, clientId: string): string | null {
  const configured = publicAccountConfig(environment).malClientId;
  const secret = environment.ANITRACK_MAL_CLIENT_SECRET;
  return configured && clientId === configured && typeof secret === 'string' && secret ? secret : null;
}
