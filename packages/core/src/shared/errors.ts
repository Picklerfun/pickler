/** A required data source could not answer. Adapters translate technical failures into this error. */
export class DataSourceUnavailableError extends Error {
  constructor(
    readonly source: string,
    options?: { cause?: unknown },
  ) {
    super(`Data source unavailable: ${source}`, options);
    this.name = "DataSourceUnavailableError";
  }
}
