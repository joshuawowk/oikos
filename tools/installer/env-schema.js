export const ENV_SCHEMA = [
  { key: 'SESSION_SECRET',              type: 'auto',    label: 'Session Secret',           required: true,  group: 'core',    writeToEnv: true },
  { key: 'DB_ENCRYPTION_KEY',           type: 'auto',    label: 'Database Encryption Key',  required: true,  group: 'core',    writeToEnv: true },
  { key: 'OPENWEATHER_API_KEY',         type: 'user',    label: 'OpenWeather API Key',      required: false, group: 'weather', writeToEnv: true },
  { key: 'OPENWEATHER_CITY',            type: 'default', label: 'City',                     default: 'Berlin', group: 'weather', writeToEnv: true },
  { key: 'OPENWEATHER_UNITS',           type: 'default', label: 'Units',                    default: 'metric', group: 'weather', writeToEnv: true },
  { key: 'OPENWEATHER_LANG',            type: 'default', label: 'Language',                 default: 'de',   group: 'weather', writeToEnv: true },
  { key: 'GOOGLE_CLIENT_ID',            type: 'user',    label: 'Google Client ID',         required: false, group: 'google',  writeToEnv: true },
  { key: 'GOOGLE_CLIENT_SECRET',        type: 'user',    label: 'Google Client Secret',     required: false, group: 'google',  writeToEnv: true },
  { key: 'GOOGLE_REDIRECT_URI',         type: 'user',    label: 'Google Redirect URI',      required: false, group: 'google',  writeToEnv: true },
  { key: 'APPLE_USERNAME',              type: 'user',    label: 'Apple ID (email)',          required: false, group: 'apple',   writeToEnv: true },
  { key: 'APPLE_APP_SPECIFIC_PASSWORD', type: 'user',    label: 'App-Specific Password',    required: false, group: 'apple',   writeToEnv: true },
  { key: 'APPLE_CALDAV_URL',            type: 'default', label: 'CalDAV URL',               default: 'https://caldav.icloud.com', group: 'apple', writeToEnv: true },
  { key: 'SYNC_INTERVAL_MINUTES',       type: 'default', label: 'Sync Interval (minutes)', default: '15',   group: 'sync',    writeToEnv: true },
  { key: 'TZ',                          type: 'default', label: 'Timezone',                 default: 'UTC',  group: 'system',  writeToEnv: true },
  { key: 'OIKOS_HTTP_PORT',             type: 'default', label: 'HTTP Port',                default: '3000', group: 'system',  writeToEnv: true },
  // Reverse-Proxy / HTTPS. SESSION_SECURE wird nur für Direktzugriff ohne HTTPS
  // geschrieben (=false); hinter einem Proxy bleibt der sichere Default aktiv.
  { key: 'SESSION_SECURE',              type: 'user',    label: 'Secure Session Cookies',   required: false, group: 'proxy',   writeToEnv: true },
  { key: 'TRUST_PROXY',                 type: 'user',    label: 'Trust Proxy',              required: false, group: 'proxy',   writeToEnv: true },
  // Single Sign-On (OIDC). Server aktiviert OIDC nur, wenn alle vier gesetzt sind.
  { key: 'OIDC_ISSUER',                 type: 'user',    label: 'OIDC Issuer',              required: false, group: 'oidc',    writeToEnv: true },
  { key: 'OIDC_CLIENT_ID',              type: 'user',    label: 'OIDC Client ID',           required: false, group: 'oidc',    writeToEnv: true },
  { key: 'OIDC_CLIENT_SECRET',          type: 'user',    label: 'OIDC Client Secret',       required: false, group: 'oidc',    writeToEnv: true },
  { key: 'OIDC_REDIRECT_URI',           type: 'user',    label: 'OIDC Redirect URI',        required: false, group: 'oidc',    writeToEnv: true },
  // Automatische Backups.
  { key: 'BACKUP_ENABLED',              type: 'default', label: 'Backups Enabled',          default: 'true', group: 'backup',  writeToEnv: true },
  { key: 'BACKUP_SCHEDULE',             type: 'default', label: 'Backup Schedule (cron)',   default: '0 2 * * *', group: 'backup', writeToEnv: true },
  { key: 'BACKUP_KEEP',                 type: 'default', label: 'Backups to Keep',          default: '7',    group: 'backup',  writeToEnv: true },
];
