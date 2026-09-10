import 'server-only';

/**
 * Read-only adapter seam. Intentionally contains no credentials, endpoint,
 * fetch call, or HighLevel SDK. A concrete connector may be added only after
 * authenticated scope proof is independently recorded and reviewed.
 */
export {
  ARCHIVE_READER_MAX_EVENTS_PER_CONTACT,
  ARCHIVE_READER_MAX_PAGES_PER_CONTACT,
  advanceArchiveReaderStream,
  buildArchiveReaderDirectory,
  classifyArchiveReaderEvent,
  isDirectArchiveSyncAvailable,
  validateArchiveReaderRequest,
} from './reader-contract';

export type {
  AuthenticatedReaderScopeProof,
  ArchiveReaderEventClassification,
  ArchiveReaderIdentity,
  ArchiveReaderPage,
  ArchiveReaderRawEvent,
  ArchiveReaderRequest,
  ArchiveReaderStreamState,
} from './reader-contract';
