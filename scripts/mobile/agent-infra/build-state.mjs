// Evaluates an ASC GET /v1/builds/{id}?include=app,preReleaseVersion response.
// Deliberately makes no writes and never equates processing with distribution.
export function buildState(response, expected) {
  if (
    !expected?.id ||
    !expected.appId ||
    !expected.version ||
    !expected.buildNumber
  )
    throw new Error('Expected identity required');
  const build = response?.data;
  const versionId = build?.relationships?.preReleaseVersion?.data?.id;
  const version = response?.included?.find(
    (item) => item.type === 'preReleaseVersions' && item.id === versionId,
  );
  if (
    build?.type !== 'builds' ||
    build.id !== expected.id ||
    build.relationships?.app?.data?.id !== expected.appId ||
    build.attributes?.version !== expected.buildNumber ||
    version?.attributes?.version !== expected.version
  )
    throw new Error('Build identity mismatch or incomplete response');
  const state = build.attributes.processingState;
  if (state === 'VALID')
    return { processing: 'valid', distribution: 'unverified', id: build.id };
  if (state === 'PROCESSING')
    return { processing: 'pending', distribution: 'unverified', id: build.id };
  if (state === 'FAILED' || state === 'INVALID')
    return { processing: 'failed', distribution: 'unverified', id: build.id };
  throw new Error(`Unknown processing state: ${state}`);
}
