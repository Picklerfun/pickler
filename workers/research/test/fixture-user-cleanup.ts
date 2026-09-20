interface FixtureDatabase {
  query(text: string, values: string[]): Promise<unknown>;
  end(): Promise<void>;
}

export async function withFixtureUserCleanup<T>(
  db: FixtureDatabase,
  run: (trackCreatedUser: (userId: string) => void) => Promise<T>,
): Promise<T> {
  const createdUsers = new Set<string>();
  try {
    return await run((userId) => createdUsers.add(userId));
  } finally {
    try {
      // Retain labelled local results for inspection, but attempt every revocation.
      const failures: unknown[] = [];
      for (const userId of createdUsers) {
        try {
          await db.query("UPDATE pickler.research_access SET enabled=false WHERE user_id=$1", [
            userId,
          ]);
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length > 0) {
        throw new AggregateError(failures, "Could not revoke all fixture users' research access");
      }
    } finally {
      await db.end();
    }
  }
}
