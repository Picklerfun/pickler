export interface Environment {
  DATABASE_URL: string;
  APP_ENV?: string;
  DATABASE_CA_CERT?: string;
  ALLOW_INSECURE_STAGING_DATABASE?: string;
  MODEL_BASE_URL: string;
  MODEL_ID: string;
  MODEL_API_KEY: string;
  EXA_API_KEY: string;
  BALLDONTLIE_API_KEY?: string | undefined;
  THE_ODDS_API_KEY?: string | undefined;
}
