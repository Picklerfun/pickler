// Servicio de reads (F1): edge functions del Supabase pickler, esquema mobile. Verificado 2026-09-20 (audit F1 §5).
export const READS_URL_DEFAULT = "https://yvdipvcrpbqvofayteqf.supabase.co/functions/v1";
export const READ_REQUEST_TIMEOUT_MS = 65_000; // read-request: el modelo tarda hasta 50 s + reembolso a los 60 s (D7, P4)
export const READS_TIMEOUT_MS = 15_000; // el resto
export const READS_POLL_MS = 15_000; // Portfolio → Reads mientras Ask está visible (D16)
