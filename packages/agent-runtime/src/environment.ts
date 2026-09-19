export interface Environment {
  DATABASE_URL: string;
  MODEL_BASE_URL: string;
  MODEL_ID: string;
  MODEL_API_KEY: string;
  EXA_API_KEY: string;
  BALLDONTLIE_API_KEY?: string | undefined;
  THE_ODDS_API_KEY?: string | undefined;
}
