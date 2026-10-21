declare const __LAST_SPIRE_BUILD__: string;
/** CI supplies the public commit SHA. Local previews never include host metadata. */
export const CLIENT_BUILD =
  typeof __LAST_SPIRE_BUILD__ === 'string' ? __LAST_SPIRE_BUILD__ : 'development';
