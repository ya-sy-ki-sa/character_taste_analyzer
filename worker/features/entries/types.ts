export type CreatedEntry = {
  entryId: string;
  jobId: string;
  outboxEventId?: string;
  profileOutboxEventId?: string;
  status: string;
  replayed: boolean;
};

export type ReanalyzedEntry = CreatedEntry & { entryRevisionId: string; revisionNumber: number };

export type EvidenceView = {
  id: string;
  verificationStatus: string;
  inferenceType: string;
  quote: string | null;
  inputPointer: string | null;
  sourceTitle: string | null;
  sourceUrl: string | null;
  sourceProvider: string | null;
  trustReason: string | null;
  canNavigate: boolean;
};
